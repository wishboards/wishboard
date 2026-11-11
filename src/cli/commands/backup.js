import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';

/**
 * Logical backup / restore / verification of a Wishboard deployment (#238, #314).
 *
 * A backup is a plain directory so it can be rsynced, zipped, or synced to S3 with any tool:
 *
 *   wishboard-backup-<timestamp>/
 *     manifest.json   table row counts, image list, and sha256 checksums
 *     database.json   schema (CREATE statements) + rows of every persistent table
 *     images/         uploaded wish images and host branding assets
 *
 * The database is dumped through the libSQL client, so the same code path covers all targets:
 * a local file, the Pi's sqld container, and hosted Turso. Images come from a local directory
 * (Pi kiosk `./data/images`) or an S3 bucket (serverless, `images/` prefix).
 */

export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_FILE = 'manifest.json';
export const DATABASE_FILE = 'database.json';
export const IMAGES_DIR = 'images';
export const S3_IMAGES_PREFIX = 'images/';

/** Ephemeral tables that are never worth restoring (stale sessions, live socket ids). */
export const EXCLUDED_TABLES = Object.freeze(['sessions', 'websocket_connections']);

const noop = () => {};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const sha256File = (file) => sha256(fs.readFileSync(file));

/** Best-effort recursive delete (Windows can briefly keep SQLite file handles open). */
function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp data only; the OS temp cleaner will reclaim it */
  }
}

const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;

/** Normalise a libSQL cell into something JSON can carry without loss. */
export function encodeCell(value) {
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : { $bigint: value.toString() };
  }
  if (value instanceof ArrayBuffer) {
    return { $blob: Buffer.from(value).toString('base64') };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      $blob: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }
  return value ?? null;
}

export function decodeCell(value) {
  if (value && typeof value === 'object') {
    if (typeof value.$bigint === 'string') return BigInt(value.$bigint);
    if (typeof value.$blob === 'string') return Buffer.from(value.$blob, 'base64');
  }
  return value;
}

export function openClient({ url, authToken }, factory = createClient) {
  if (!url) {
    throw new Error('A database URL is required (--database-url or DATABASE_URL).');
  }
  // intMode 'bigint' so integers beyond 2^53 are dumped losslessly instead of throwing.
  return factory({ url, intMode: 'bigint', ...(authToken ? { authToken } : {}) });
}

async function listTables(client) {
  const rs = await client.execute(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream_%' " +
      'ORDER BY rowid'
  );
  return rs.rows
    .map((row) => ({ name: String(row.name), sql: String(row.sql) }))
    .filter((t) => !EXCLUDED_TABLES.includes(t.name));
}

/** Dump schema + rows for every persistent table. */
export async function dumpDatabase(client) {
  const tables = {};
  for (const { name, sql } of await listTables(client)) {
    const rs = await client.execute(`SELECT * FROM ${quoteIdent(name)}`);
    tables[name] = {
      sql,
      columns: rs.columns,
      rows: rs.rows.map((row) => rs.columns.map((_, i) => encodeCell(row[i]))),
    };
  }
  return { tables };
}

/** Replace the given tables on `client` with the dumped schema and rows. */
export async function loadDatabase(client, dump) {
  try {
    await client.execute('PRAGMA foreign_keys = OFF');
  } catch {
    /* remote drivers may reject PRAGMAs; ordering below keeps parents first anyway */
  }
  const names = Object.keys(dump.tables);
  for (const name of [...names].reverse()) {
    await client.execute(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
  }
  for (const name of names) {
    const { sql, columns, rows } = dump.tables[name];
    await client.execute(sql);
    const statement = `INSERT INTO ${quoteIdent(name)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows
        .slice(i, i + BATCH_SIZE)
        .map((row) => ({ sql: statement, args: row.map(decodeCell) }));
      await client.batch(batch, 'write'); // NOSONAR
    }
  }
}

/* ------------------------------------------------------------------ images */

function listLocalImages(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

async function getS3(deps) {
  if (deps.s3) return deps.s3;
  const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } =
    await import('@aws-sdk/client-s3');
  const client = new S3Client({});
  return {
    async list(bucket) {
      const keys = [];
      let token;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: S3_IMAGES_PREFIX,
            ContinuationToken: token,
          })
        );
        for (const obj of res.Contents ?? []) {
          if (obj.Key && obj.Key !== S3_IMAGES_PREFIX) keys.push(obj.Key);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async get(bucket, key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async put(bucket, key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
  };
}

async function copyImagesIn(opts, destDir, deps) {
  fs.mkdirSync(destDir, { recursive: true });
  const names = [];
  if (opts.s3Bucket) {
    const s3 = await getS3(deps);
    for (const key of await s3.list(opts.s3Bucket)) {
      const name = path.basename(key);
      fs.writeFileSync(path.join(destDir, name), await s3.get(opts.s3Bucket, key));
      names.push(name);
    }
  } else {
    for (const name of listLocalImages(opts.imagesDir)) {
      fs.copyFileSync(path.join(opts.imagesDir, name), path.join(destDir, name));
      names.push(name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

async function copyImagesOut(srcDir, opts, deps) {
  const names = listLocalImages(srcDir);
  if (opts.s3Bucket) {
    const s3 = await getS3(deps);
    for (const name of names) {
      await s3.put(
        opts.s3Bucket,
        `${S3_IMAGES_PREFIX}${name}`,
        fs.readFileSync(path.join(srcDir, name))
      );
    }
  } else if (opts.imagesDir) {
    fs.mkdirSync(opts.imagesDir, { recursive: true });
    for (const name of names) {
      fs.copyFileSync(path.join(srcDir, name), path.join(opts.imagesDir, name));
    }
  }
  return names.length;
}

/* ----------------------------------------------------------------- backup */

export function backupDirName(now = new Date()) {
  return `wishboard-backup-${now.toISOString().replaceAll(/[:.]/g, '-')}`;
}

/**
 * Create a backup directory. Returns `{ dir, manifest }`, or `null` on failure.
 * @param {{ databaseUrl?: string, authToken?: string, imagesDir?: string, s3Bucket?: string,
 *           out?: string, dryRun?: boolean }} opts
 */
export async function createBackup(
  opts = {},
  log = console.log,
  logError = console.error,
  deps = {}
) {
  const out = path.resolve(opts.out || 'backups');
  if (opts.dryRun) {
    log(
      `[DRY RUN] Would back up ${opts.databaseUrl || process.env.DATABASE_URL || '(no database url)'} ` +
        `and images from ${opts.s3Bucket ? `s3://${opts.s3Bucket}/${S3_IMAGES_PREFIX}` : opts.imagesDir || '(no images dir)'} into ${out}.`
    );
    return { dir: out, manifest: null };
  }

  const client = openClient(
    {
      url: opts.databaseUrl || process.env.DATABASE_URL,
      authToken: opts.authToken || process.env.DATABASE_AUTH_TOKEN,
    },
    deps.createClient
  );
  const dir = path.join(out, backupDirName(deps.now?.()));
  try {
    const dump = await dumpDatabase(client);
    fs.mkdirSync(dir, { recursive: true });
    const databaseJson = JSON.stringify(dump);
    fs.writeFileSync(path.join(dir, DATABASE_FILE), databaseJson);

    const imageNames = await copyImagesIn(opts, path.join(dir, IMAGES_DIR), deps);
    const images = Object.fromEntries(
      imageNames.map((name) => [name, sha256File(path.join(dir, IMAGES_DIR, name))])
    );

    const manifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: (deps.now?.() ?? new Date()).toISOString(),
      excludedTables: EXCLUDED_TABLES,
      databaseSha256: sha256(databaseJson),
      tables: Object.fromEntries(Object.entries(dump.tables).map(([n, t]) => [n, t.rows.length])),
      images,
    };
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
    log(
      `Backup written to ${dir} (${Object.keys(manifest.tables).length} tables, ${imageNames.length} images).`
    );
    return { dir, manifest };
  } catch (err) {
    removeDir(dir);
    logError(`Error creating backup: ${err.message}`);
    return null;
  } finally {
    client.close?.();
  }
}

/* ----------------------------------------------------------------- verify */

function readBackup(dir) {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  const databasePath = path.join(dir, DATABASE_FILE);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(databasePath)) {
    throw new Error(
      `'${dir}' is not a Wishboard backup (missing ${MANIFEST_FILE} or ${DATABASE_FILE}).`
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version: ${manifest.formatVersion}.`);
  }
  const databaseJson = fs.readFileSync(databasePath, 'utf8');
  return { manifest, databaseJson, dump: JSON.parse(databaseJson) };
}

/**
 * Recovery test (#314): prove a backup is intact AND restorable by loading it into a throwaway
 * database, then checking checksums, row counts, SQLite integrity, FK integrity, and that every
 * `wishes.image_id` points at an image in the backup.
 * @returns {Promise<{ ok: boolean, errors: string[], warnings: string[], tables: Record<string, number> }>}
 */
export async function verifyBackup(dir, opts = {}, log = console.log, deps = {}) {
  const errors = [];
  const warnings = [];
  const { manifest, databaseJson, dump } = readBackup(path.resolve(dir));

  if (sha256(databaseJson) !== manifest.databaseSha256) {
    errors.push(`${DATABASE_FILE} checksum mismatch (backup is corrupt or was modified).`);
  }
  for (const [name, expected] of Object.entries(manifest.images)) {
    const file = path.join(dir, IMAGES_DIR, name);
    if (!fs.existsSync(file)) errors.push(`Image missing from backup: ${name}`);
    else if (sha256File(file) !== expected) errors.push(`Image checksum mismatch: ${name}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-verify-'));
  const client = openClient({ url: `file:${path.join(tmp, 'verify.db')}` }, deps.createClient);
  const tables = {};
  try {
    await loadDatabase(client, dump);
    for (const [name, expected] of Object.entries(manifest.tables)) {
      const rs = await client.execute(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`);
      tables[name] = Number(rs.rows[0].n);
      if (tables[name] !== expected) {
        errors.push(
          `Row count mismatch in '${name}': expected ${expected}, restored ${tables[name]}.`
        );
      }
    }
    const integrity = await client.execute('PRAGMA integrity_check');
    if (String(integrity.rows[0][0]) !== 'ok') {
      errors.push(`SQLite integrity_check failed: ${String(integrity.rows[0][0])}`);
    }
    const fk = await client.execute('PRAGMA foreign_key_check');
    if (fk.rows.length > 0) {
      errors.push(`${fk.rows.length} foreign key violation(s) after restore.`);
    }
    if (manifest.tables.wishes !== undefined) {
      const refs = await client.execute(
        "SELECT id, image_id FROM wishes WHERE image_id IS NOT NULL AND image_id != ''"
      );
      for (const row of refs.rows) {
        const name = path.basename(String(row.image_id));
        if (!(name in manifest.images)) {
          warnings.push(`Wish ${row.id} references image '${name}' that is not in the backup.`);
        }
      }
    }
  } catch (err) {
    errors.push(`Restore into temporary database failed: ${err.message}`);
  } finally {
    client.close?.();
    removeDir(tmp);
  }

  const ok = errors.length === 0 && (!opts.strict || warnings.length === 0);
  for (const e of errors) log(`FAIL: ${e}`);
  for (const w of warnings) log(`WARN: ${w}`);
  log(ok ? `Backup verified: ${dir}` : `Backup verification FAILED: ${dir}`);
  return { ok, errors, warnings, tables };
}

/* ---------------------------------------------------------------- restore */

/**
 * Restore a backup into a target database (and image store). Destructive: tables present in the
 * backup are dropped and recreated, so a target that already holds rows requires `force`.
 */
export async function restoreBackup(
  dir,
  opts = {},
  log = console.log,
  logError = console.error,
  deps = {}
) {
  if (opts.dryRun) {
    log(
      `[DRY RUN] Would restore ${dir} into ${opts.databaseUrl || process.env.DATABASE_URL || '(no database url)'}.`
    );
    return true;
  }
  const resolved = path.resolve(dir);
  const { dump } = readBackup(resolved);
  const report = await verifyBackup(resolved, { strict: false }, noop, deps);
  if (!report.ok) {
    logError(
      `Refusing to restore a backup that failed verification:\n  ${report.errors.join('\n  ')}`
    );
    return false;
  }

  const client = openClient(
    {
      url: opts.databaseUrl || process.env.DATABASE_URL,
      authToken: opts.authToken || process.env.DATABASE_AUTH_TOKEN,
    },
    deps.createClient
  );
  try {
    if (!opts.force) {
      for (const name of Object.keys(dump.tables)) {
        let count = 0;
        try {
          const rs = await client.execute(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`);
          count = Number(rs.rows[0].n);
        } catch {
          /* table does not exist yet: nothing to overwrite */
        }
        if (count > 0) {
          logError(
            `Target database already contains data in '${name}'. Re-run with --force to overwrite.`
          );
          return false;
        }
      }
    }
    await loadDatabase(client, dump);
    const imageCount = await copyImagesOut(path.join(resolved, IMAGES_DIR), opts, deps);
    log(
      `Restored ${Object.keys(dump.tables).length} tables and ${imageCount} images from ${resolved}.`
    );
    return true;
  } catch (err) {
    logError(`Error restoring backup: ${err.message}`);
    return false;
  } finally {
    client.close?.();
  }
}
