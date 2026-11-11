/** @vitest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBackup,
  verifyBackup,
  restoreBackup,
  dumpDatabase,
  loadDatabase,
  encodeCell,
  decodeCell,
  openClient,
  backupDirName,
  DATABASE_FILE,
  MANIFEST_FILE,
  IMAGES_DIR,
  EXCLUDED_TABLES,
} from './backup.js';

const s3Send = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-s3', () => {
  const cmd = (type) =>
    class {
      constructor(input) {
        this.type = type;
        this.input = input;
      }
    };
  return {
    S3Client: class {
      send(command) {
        return s3Send(command);
      }
    },
    ListObjectsV2Command: cmd('list'),
    GetObjectCommand: cmd('get'),
    PutObjectCommand: cmd('put'),
  };
});

const SCHEMA = [
  'CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL)',
  'CREATE TABLE wishes (id TEXT PRIMARY KEY, user_id TEXT, content TEXT NOT NULL, image_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id))',
  'CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL)',
  'CREATE TABLE websocket_connections (connection_id TEXT PRIMARY KEY)',
  'CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB, big INTEGER)',
];

async function seed(client) {
  for (const sql of SCHEMA) await client.execute(sql);
  await client.execute("INSERT INTO users VALUES ('u1', 'alice')");
  await client.execute("INSERT INTO wishes VALUES ('w1', 'u1', 'hello', 'photo.png')");
  await client.execute("INSERT INTO wishes VALUES ('w2', NULL, 'no image', NULL)");
  await client.execute("INSERT INTO sessions VALUES ('t1', 'u1')");
  await client.execute("INSERT INTO websocket_connections VALUES ('c1')");
  await client.execute({
    sql: 'INSERT INTO blobs VALUES (1, ?, 9007199254740993)',
    args: [new Uint8Array([1, 2, 3, 250]).buffer],
  });
}

describe('backup / restore / verify', () => {
  let tmp;
  let srcUrl;
  let src;
  let imagesDir;
  let outDir;
  const quiet = () => {};

  const fileClient = (name) =>
    createClient({ url: `file:${path.join(tmp, name)}`, intMode: 'bigint' });

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-backup-test-'));
    srcUrl = `file:${path.join(tmp, 'src.db')}`;
    src = createClient({ url: srcUrl, intMode: 'bigint' });
    await seed(src);
    imagesDir = path.join(tmp, 'images');
    fs.mkdirSync(imagesDir);
    fs.writeFileSync(path.join(imagesDir, 'photo.png'), 'PNGDATA');
    fs.writeFileSync(path.join(imagesDir, '.gitkeep'), '');
    outDir = path.join(tmp, 'out');
  });

  afterEach(() => {
    src.close();
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      /* Windows may hold SQLite handles briefly */
    }
  });

  const makeBackup = async (extra = {}) => {
    const result = await createBackup(
      { databaseUrl: srcUrl, imagesDir, out: outDir, ...extra },
      quiet,
      quiet
    );
    expect(result).not.toBeNull();
    return result;
  };

  describe('cell codec', () => {
    it('round-trips bigints, blobs, and nulls', () => {
      expect(encodeCell(5n)).toBe(5);
      const huge = encodeCell(9007199254740993n);
      expect(huge).toEqual({ $bigint: '9007199254740993' });
      expect(decodeCell(huge)).toBe(9007199254740993n);
      const blob = encodeCell(new Uint8Array([1, 2, 3]).buffer);
      expect(Buffer.from(decodeCell(blob))).toEqual(Buffer.from([1, 2, 3]));
      const view = encodeCell(new Uint8Array([4, 5]));
      expect(Buffer.from(decodeCell(view))).toEqual(Buffer.from([4, 5]));
      expect(encodeCell(undefined)).toBeNull();
      expect(encodeCell('x')).toBe('x');
      expect(decodeCell('x')).toBe('x');
      expect(decodeCell(null)).toBeNull();
      expect(decodeCell({ other: 1 })).toEqual({ other: 1 });
    });
  });

  it('openClient requires a url and forwards the auth token', () => {
    expect(() => openClient({})).toThrow(/database URL is required/);
    const factory = vi.fn().mockReturnValue({});
    openClient({ url: 'libsql://x', authToken: 't' }, factory);
    expect(factory).toHaveBeenCalledWith({ url: 'libsql://x', intMode: 'bigint', authToken: 't' });
    openClient({ url: 'libsql://x' }, factory);
    expect(factory).toHaveBeenLastCalledWith({ url: 'libsql://x', intMode: 'bigint' });
  });

  it('backupDirName is filesystem-safe', () => {
    expect(backupDirName(new Date('2026-01-02T03:04:05.678Z'))).toBe(
      'wishboard-backup-2026-01-02T03-04-05-678Z'
    );
  });

  describe('createBackup', () => {
    it('writes manifest, database dump, and images; skips ephemeral tables', async () => {
      const { dir, manifest } = await makeBackup();
      expect(fs.existsSync(path.join(dir, MANIFEST_FILE))).toBe(true);
      expect(fs.existsSync(path.join(dir, DATABASE_FILE))).toBe(true);
      expect(fs.readFileSync(path.join(dir, IMAGES_DIR, 'photo.png'), 'utf8')).toBe('PNGDATA');
      expect(Object.keys(manifest.images)).toEqual(['photo.png']);
      expect(manifest.tables).toEqual({ users: 1, wishes: 2, blobs: 1 });
      for (const t of EXCLUDED_TABLES) expect(manifest.tables[t]).toBeUndefined();
    });

    it('supports a dry run without touching disk', async () => {
      const logs = [];
      const res = await createBackup(
        { dryRun: true, databaseUrl: srcUrl, imagesDir, out: outDir },
        (m) => logs.push(m)
      );
      expect(res.manifest).toBeNull();
      expect(logs[0]).toContain('[DRY RUN]');
      expect(fs.existsSync(outDir)).toBe(false);
      const s3Logs = [];
      await createBackup({ dryRun: true, s3Bucket: 'b' }, (m) => s3Logs.push(m));
      expect(s3Logs[0]).toContain('s3://b/images/');
    });

    it('returns null and cleans up when the database is unreachable', async () => {
      const errors = [];
      const res = await createBackup(
        { databaseUrl: srcUrl, imagesDir, out: outDir },
        quiet,
        (m) => errors.push(m),
        {
          createClient: () => ({
            execute: async () => {
              throw new Error('boom');
            },
            close: () => {},
          }),
        }
      );
      expect(res).toBeNull();
      expect(errors[0]).toContain('boom');
      expect(fs.existsSync(outDir) ? fs.readdirSync(outDir) : []).toEqual([]);
    });

    it('backs up with no images directory', async () => {
      const { manifest } = await makeBackup({ imagesDir: path.join(tmp, 'nope') });
      expect(manifest.images).toEqual({});
    });

    it('pulls images from S3 when a bucket is given', async () => {
      const s3 = {
        list: vi.fn().mockResolvedValue(['images/s3.png']),
        get: vi.fn().mockResolvedValue(Buffer.from('S3DATA')),
        put: vi.fn(),
      };
      const { dir, manifest } = await createBackup(
        { databaseUrl: srcUrl, s3Bucket: 'bkt', out: outDir },
        quiet,
        quiet,
        { s3 }
      );
      expect(s3.get).toHaveBeenCalledWith('bkt', 'images/s3.png');
      expect(Object.keys(manifest.images)).toEqual(['s3.png']);
      expect(fs.readFileSync(path.join(dir, IMAGES_DIR, 's3.png'), 'utf8')).toBe('S3DATA');
    });

    it('uses DATABASE_URL from the environment when no flag is given', async () => {
      vi.stubEnv('DATABASE_URL', srcUrl);
      try {
        const res = await createBackup({ imagesDir, out: outDir }, quiet, quiet);
        expect(res.manifest.tables.users).toBe(1);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('verifyBackup', () => {
    it('passes for a healthy backup and reports restored row counts', async () => {
      const { dir } = await makeBackup();
      const report = await verifyBackup(dir, {}, quiet);
      expect(report.ok).toBe(true);
      expect(report.errors).toEqual([]);
      expect(report.tables).toEqual({ users: 1, wishes: 2, blobs: 1 });
    });

    it('rejects a directory that is not a backup', async () => {
      await expect(verifyBackup(tmp, {}, quiet)).rejects.toThrow(/not a Wishboard backup/);
    });

    it('rejects an unsupported format version', async () => {
      const { dir } = await makeBackup();
      const mPath = path.join(dir, MANIFEST_FILE);
      const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      m.formatVersion = 99;
      fs.writeFileSync(mPath, JSON.stringify(m));
      await expect(verifyBackup(dir, {}, quiet)).rejects.toThrow(/Unsupported backup format/);
    });

    it('detects a tampered database dump', async () => {
      const { dir } = await makeBackup();
      const dPath = path.join(dir, DATABASE_FILE);
      fs.writeFileSync(dPath, fs.readFileSync(dPath, 'utf8').replace('alice', 'mallory'));
      const logs = [];
      const report = await verifyBackup(dir, {}, (m) => logs.push(m));
      expect(report.ok).toBe(false);
      expect(report.errors.join()).toContain('checksum mismatch');
      expect(logs.some((l) => l.startsWith('FAIL:'))).toBe(true);
    });

    it('detects missing and corrupted images', async () => {
      const { dir } = await makeBackup();
      fs.writeFileSync(path.join(dir, IMAGES_DIR, 'photo.png'), 'CORRUPT');
      let report = await verifyBackup(dir, {}, quiet);
      expect(report.errors.join()).toContain('Image checksum mismatch: photo.png');
      fs.rmSync(path.join(dir, IMAGES_DIR, 'photo.png'));
      report = await verifyBackup(dir, {}, quiet);
      expect(report.errors.join()).toContain('Image missing from backup: photo.png');
    });

    it('detects row-count drift', async () => {
      const { dir } = await makeBackup();
      const mPath = path.join(dir, MANIFEST_FILE);
      const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      m.tables.users = 5;
      fs.writeFileSync(mPath, JSON.stringify(m));
      const report = await verifyBackup(dir, {}, quiet);
      expect(report.errors.join()).toContain("Row count mismatch in 'users': expected 5");
    });

    it('detects foreign key violations', async () => {
      await src.execute('PRAGMA foreign_keys = OFF');
      await src.execute("INSERT INTO wishes VALUES ('w3', 'ghost', 'orphan', NULL)");
      const { dir } = await makeBackup();
      const report = await verifyBackup(dir, {}, quiet);
      expect(report.ok).toBe(false);
      expect(report.errors.join()).toContain('foreign key violation');
    });

    it('warns about dangling image references and fails only in strict mode', async () => {
      fs.rmSync(path.join(imagesDir, 'photo.png'));
      const { dir } = await makeBackup();
      const logs = [];
      const lenient = await verifyBackup(dir, {}, (m) => logs.push(m));
      expect(lenient.ok).toBe(true);
      expect(lenient.warnings[0]).toContain("'photo.png' that is not in the backup");
      expect(logs.some((l) => l.startsWith('WARN:'))).toBe(true);
      const strict = await verifyBackup(dir, { strict: true }, quiet);
      expect(strict.ok).toBe(false);
    });

    it('reports a failed temp restore instead of throwing', async () => {
      const { dir } = await makeBackup();
      const dPath = path.join(dir, DATABASE_FILE);
      const dump = JSON.parse(fs.readFileSync(dPath, 'utf8'));
      dump.tables.users.sql = 'CREATE TABLE nonsense (';
      const json = JSON.stringify(dump);
      fs.writeFileSync(dPath, json);
      const mPath = path.join(dir, MANIFEST_FILE);
      const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      const { createHash } = await import('node:crypto');
      m.databaseSha256 = createHash('sha256').update(json).digest('hex');
      fs.writeFileSync(mPath, JSON.stringify(m));
      const report = await verifyBackup(dir, {}, quiet);
      expect(report.ok).toBe(false);
      expect(report.errors.join()).toContain('Restore into temporary database failed');
    });
  });

  describe('restoreBackup', () => {
    it('round-trips data, blobs, bigints, and images into an empty target', async () => {
      const { dir } = await makeBackup();
      const targetUrl = `file:${path.join(tmp, 'target.db')}`;
      const targetImages = path.join(tmp, 'restored-images');
      const ok = await restoreBackup(
        dir,
        { databaseUrl: targetUrl, imagesDir: targetImages },
        quiet,
        quiet
      );
      expect(ok).toBe(true);
      expect(fs.readFileSync(path.join(targetImages, 'photo.png'), 'utf8')).toBe('PNGDATA');

      const target = createClient({ url: targetUrl, intMode: 'bigint' });
      const users = await target.execute('SELECT * FROM users');
      expect(users.rows.map((r) => r.username)).toEqual(['alice']);
      const blobs = await target.execute('SELECT data, big FROM blobs');
      expect(Buffer.from(blobs.rows[0].data)).toEqual(Buffer.from([1, 2, 3, 250]));
      expect(String(blobs.rows[0].big)).toBe('9007199254740993');
      target.close();
    });

    it('refuses to overwrite a populated target without --force, and overwrites with it', async () => {
      const { dir } = await makeBackup();
      const targetUrl = `file:${path.join(tmp, 'populated.db')}`;
      const target = createClient({ url: targetUrl, intMode: 'bigint' });
      await target.execute(
        'CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL)'
      );
      await target.execute("INSERT INTO users VALUES ('x', 'existing')");
      const errors = [];
      const refused = await restoreBackup(
        dir,
        { databaseUrl: targetUrl, imagesDir: path.join(tmp, 'i2') },
        quiet,
        (m) => errors.push(m)
      );
      expect(refused).toBe(false);
      expect(errors[0]).toContain('--force');

      const forced = await restoreBackup(
        dir,
        { databaseUrl: targetUrl, imagesDir: path.join(tmp, 'i2'), force: true },
        quiet,
        quiet
      );
      expect(forced).toBe(true);
      const users = await target.execute('SELECT username FROM users');
      expect(users.rows.map((r) => r.username)).toEqual(['alice']);
      target.close();
    });

    it('refuses to restore a backup that fails verification', async () => {
      const { dir } = await makeBackup();
      fs.writeFileSync(path.join(dir, IMAGES_DIR, 'photo.png'), 'CORRUPT');
      const errors = [];
      const ok = await restoreBackup(
        dir,
        { databaseUrl: `file:${path.join(tmp, 't.db')}` },
        quiet,
        (m) => errors.push(m)
      );
      expect(ok).toBe(false);
      expect(errors[0]).toContain('failed verification');
    });

    it('supports a dry run', async () => {
      const logs = [];
      const ok = await restoreBackup('whatever', { dryRun: true }, (m) => logs.push(m));
      expect(ok).toBe(true);
      expect(logs[0]).toContain('[DRY RUN]');
    });

    it('uploads images to S3 when a bucket is given', async () => {
      const { dir } = await makeBackup();
      const s3 = { list: vi.fn(), get: vi.fn(), put: vi.fn() };
      const ok = await restoreBackup(
        dir,
        { databaseUrl: `file:${path.join(tmp, 's3t.db')}`, s3Bucket: 'bkt' },
        quiet,
        quiet,
        { s3 }
      );
      expect(ok).toBe(true);
      expect(s3.put).toHaveBeenCalledWith('bkt', 'images/photo.png', expect.any(Buffer));
    });

    it('reports restore errors from the target database', async () => {
      const { dir } = await makeBackup();
      const errors = [];
      const ok = await restoreBackup(
        dir,
        { databaseUrl: 'file:x', force: true },
        quiet,
        (m) => errors.push(m),
        {
          createClient: (cfg) => {
            if (cfg.url === 'file:x') {
              return {
                execute: async () => {
                  throw new Error('target down');
                },
                batch: async () => {},
                close: () => {},
              };
            }
            return createClient(cfg);
          },
        }
      );
      expect(ok).toBe(false);
      expect(errors[0]).toContain('target down');
    });
  });

  describe('default S3 adapter', () => {
    it('lists (paginated), downloads, and uploads via the AWS SDK', async () => {
      const pages = [
        {
          Contents: [{ Key: 'images/' }, { Key: 'images/a.png' }],
          IsTruncated: true,
          NextContinuationToken: 'n',
        },
        { Contents: [{ Key: 'images/b.png' }], IsTruncated: false },
        { Contents: undefined, IsTruncated: false },
      ];
      s3Send.mockImplementation(async (command) => {
        if (command.type === 'list') return pages.shift();
        if (command.type === 'get') {
          return {
            Body: { transformToByteArray: async () => new TextEncoder().encode(command.input.Key) },
          };
        }
        return {};
      });
      const { dir, manifest } = await createBackup(
        { databaseUrl: srcUrl, s3Bucket: 'bkt', out: outDir },
        quiet,
        quiet
      );
      expect(Object.keys(manifest.images)).toEqual(['a.png', 'b.png']);
      expect(fs.readFileSync(path.join(dir, IMAGES_DIR, 'a.png'), 'utf8')).toBe('images/a.png');

      const ok = await restoreBackup(
        dir,
        { databaseUrl: `file:${path.join(tmp, 'viaS3.db')}`, s3Bucket: 'bkt' },
        quiet,
        quiet
      );
      expect(ok).toBe(true);
      const puts = s3Send.mock.calls.map(([c]) => c).filter((c) => c.type === 'put');
      expect(puts.map((c) => c.input.Key).sort()).toEqual(['images/a.png', 'images/b.png']);
      expect(pages.length).toBe(1);
    });
  });

  describe('dump / load', () => {
    it('tolerates drivers that reject PRAGMA foreign_keys', async () => {
      const dump = await dumpDatabase(src);
      const target = fileClient('pragma.db');
      const real = target.execute.bind(target);
      target.execute = (stmt) =>
        typeof stmt === 'string' && stmt.startsWith('PRAGMA')
          ? Promise.reject(new Error('unsupported statement'))
          : real(stmt);
      await loadDatabase(target, dump);
      const rs = await real('SELECT COUNT(*) AS n FROM wishes');
      expect(Number(rs.rows[0].n)).toBe(2);
      target.close();
    });
  });
});
