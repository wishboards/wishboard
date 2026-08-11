import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

let url = process.env.DATABASE_URL;

// Prevent tests from corrupting the local development database
if (process.env.NODE_ENV === 'test' && !process.env.WISHBOARD_DB_PATH && !url) {
  process.env.WISHBOARD_DB_PATH = ':memory:';
}

if (!url) {
  // Only when there is no external DATABASE_URL do we persist to a local file
  // under dataDir, so create it here. On AWS Lambda DATABASE_URL points at EFS
  // and the bundle dir (/var/task) is read-only, so we must NOT mkdir there.
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.WISHBOARD_DB_PATH || path.join(dataDir, 'wishboard.db');
  url = dbPath === ':memory:' ? 'file::memory:' : `file:${dbPath}`;
}

// Turso (hosted libSQL) requires an auth token; a local file or the Pi's
// unauthenticated sqld does not. Resolve it from, in order: an explicit
// DATABASE_AUTH_TOKEN env var (local dev, tests, the Pi), or a SecureString SSM
// parameter named by DATABASE_AUTH_TOKEN_SSM (the serverless target — so the
// token never lives in the template, the deploy command, or CI; the Lambda's
// role reads it at cold start). Pass it only when present so the file, Pi, and
// Turso targets all share one client.
let authToken = process.env.DATABASE_AUTH_TOKEN;
if (!authToken && process.env.DATABASE_AUTH_TOKEN_SSM) {
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const profile = process.env.AWS_PROFILE;
  const ssm = new SSMClient({ region, ...(profile ? { profile } : {}) });
  const res = await ssm.send(
    new GetParameterCommand({ Name: process.env.DATABASE_AUTH_TOKEN_SSM, WithDecryption: true })
  );
  authToken = res.Parameter?.Value;
}
const db = createClient(authToken ? { url, authToken } : { url });

// Concurrency hardening for the serverless target, where the ApiFunction and
// WebSocketFunction Lambdas share one SQLite file over EFS: wait up to 5s for a
// write lock instead of failing immediately with SQLITE_BUSY when writes overlap.
// The database stays in the default rollback-journal mode ON PURPOSE — do NOT
// enable WAL on the EFS deployment: WAL coordinates via single-host shared memory
// and will corrupt a database accessed from multiple Lambda hosts over a network
// filesystem. See docs/adr/0002-serverless-database-architecture.md.
// Connection PRAGMAs are applied individually and best-effort. A remote
// libSQL/sqld server (the Pi/container deployment, DATABASE_URL=http://…) manages
// concurrency itself and its Hrana parser rejects these as an "unsupported
// statement" — and rejecting them *inside* an executeMultiple() sequence aborts
// the whole schema init, which crash-loops the app. Run each on its own so a
// local file DB still gets FK enforcement + a 5s write-lock wait, while an
// unsupported PRAGMA on the remote driver is skipped instead of fatal.
for (const pragma of ['PRAGMA foreign_keys = ON', 'PRAGMA busy_timeout = 5000']) {
  try {
    await db.execute(pragma);
  } catch (err) {
    console.warn(`Skipping unsupported "${pragma}" on this database driver: ${err.message}`);
  }
}

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passphrase_hash TEXT NOT NULL,
    passphrase_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    identity_attributes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS wishes (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    content TEXT NOT NULL,
    secret_hash TEXT,
    creator_attributes TEXT,
    desired_attributes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    flagged INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS wishmails (
    id TEXT PRIMARY KEY,
    wish_id TEXT NOT NULL,
    content TEXT NOT NULL,
    return_contacts TEXT,
    sender_id TEXT,
    parent_mail_id TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(wish_id) REFERENCES wishes(id) ON DELETE CASCADE,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(parent_mail_id) REFERENCES wishmails(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS websocket_connections (
    connection_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    rule_type TEXT NOT NULL,
    trigger_attribute TEXT NOT NULL,
    trigger_value TEXT NOT NULL,
    context_attribute TEXT,
    context_value TEXT,
    target_attribute TEXT NOT NULL,
    target_value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wish_exclusions (
    user_id TEXT NOT NULL,
    wish_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, wish_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
  );
`);

// WAL is opt-in for single-node deployments (the Pi/kiosk, set via
// WISHBOARD_DB_WAL=1 in the production container). It lets readers (the display
// and phones searching) run without blocking the writer during submission
// bursts. Guards keep it OFF for serverless: WAL requires single-host shared
// memory and would corrupt the EFS-shared file across Lambda hosts — so we
// require the explicit flag AND refuse it in Lambda AND only for a local file
// (never :memory:, never a remote libSQL URL).
if (
  process.env.WISHBOARD_DB_WAL === '1' &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME &&
  url.startsWith('file:') &&
  url !== 'file::memory:'
) {
  await db.execute('PRAGMA journal_mode = WAL');
}

const ensureColumn = async (table, column, type) => {
  const rs = await db.execute(`PRAGMA table_info(${table})`);
  const hasColumn = rs.rows.some((info) => info.name === column);
  if (!hasColumn) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
};

await ensureColumn('users', 'identity_attributes', 'TEXT');
await ensureColumn('users', 'contacts', 'TEXT');
await ensureColumn('users', 'wishmail_enabled', 'INTEGER DEFAULT 0');
await ensureColumn('users', 'is_active', 'INTEGER DEFAULT 1');
await ensureColumn('wishes', 'creator_attributes', 'TEXT');
await ensureColumn('wishes', 'desired_attributes', 'TEXT');
await ensureColumn('wishes', 'contacts', 'TEXT');
await ensureColumn('wishes', 'wishmail_enabled', 'INTEGER DEFAULT 0');
await ensureColumn('wishes', 'is_active', 'INTEGER DEFAULT 1');
await ensureColumn('wishes', 'image_id', 'TEXT');

// WebSocket subscription state (serverless API Gateway target). Board events
// (wish:*) broadcast to connections that explicitly subscribed, sys:log is an admin-only, opt-in channel:
// user_id records who owns the connection, sub_syslog whether they've subscribed
// to the log stream. sub_wishes whether they've subscribed to the wish event firehose. See ADR 0003 and #189.
await ensureColumn('websocket_connections', 'user_id', 'TEXT');
await ensureColumn('websocket_connections', 'sub_syslog', 'INTEGER DEFAULT 0');
await ensureColumn('websocket_connections', 'sub_wishes', 'INTEGER DEFAULT 0');

const defaultAdminUsername = process.env.WISHBOARD_ADMIN_USERNAME || 'admin';
const defaultAdminSecret = process.env.WISHBOARD_ADMIN_SECRET || 'admin-board';

const ensureDefaultAdmin = async () => {
  const rs = await db.execute({
    sql: 'SELECT id FROM users WHERE role = ? LIMIT 1',
    args: ['admin'],
  });
  if (rs.rows.length > 0) {
    return;
  }

  const scryptOptions = process.env.NODE_ENV === 'test' ? { N: 16, r: 1, p: 1 } : undefined;

  const scrypt = promisify(crypto.scrypt);
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(defaultAdminSecret, salt, 64, scryptOptions);
  const hash = derivedKey.toString('hex');
  const adminId = `admin-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  await db.execute({
    sql: 'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [adminId, defaultAdminUsername, hash, salt, 'admin', now],
  });

  console.log(`Created default admin account: ${defaultAdminUsername}`);
  console.log('Set WISHBOARD_ADMIN_SECRET to change the default password.');
};

await ensureDefaultAdmin();

const localDbPath = path.join(dataDir, 'wishboard.db');
const migrationFlag = path.join(dataDir, '.migrated_to_libsql');

// If using a remote libSQL server and an old local SQLite database exists, migrate it
if (url.startsWith('http') && fs.existsSync(localDbPath) && !fs.existsSync(migrationFlag)) {
  console.log('Found legacy SQLite database. Migrating data to libSQL server...');
  const localDb = createClient({ url: `file:${localDbPath}` });

  const tablesToMigrate = ['users', 'sessions', 'wishes', 'wishmails'];
  for (const table of tablesToMigrate) {
    try {
      const rs = await localDb.execute(`SELECT * FROM ${table}`);
      if (rs.rows.length > 0) {
        console.log(`Migrating ${rs.rows.length} rows for table ${table}...`);

        const stmts = rs.rows.map((row) => {
          const columns = Object.keys(row).join(', ');
          const placeholders = Object.keys(row)
            .map(() => '?')
            .join(', ');
          const values = Object.values(row);

          return {
            sql: `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${placeholders})`,
            args: values,
          };
        });

        const BATCH_SIZE = 1000;
        for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
          const batch = stmts.slice(i, i + BATCH_SIZE);
          await db.batch(batch, 'write');
        }
      }
    } catch (err) {
      console.warn(`Could not migrate table ${table} (might not exist in old db):`, err.message);
    }
  }

  fs.writeFileSync(migrationFlag, new Date().toISOString());
  console.log('Migration complete!');
}

// SQLite boolean mapping (true -> 1, false -> 0, undefined -> null).
// Exported so callers building their own batch statements map args identically.
export const mapArg = (a) => {
  if (a === undefined) return null;
  if (typeof a === 'boolean') return a ? 1 : 0;
  return a;
};

const dbWrapper = {
  prepare: (sql) => ({
    get: async (...args) => {
      const rs = await db.execute({ sql, args: args.map(mapArg) });
      return rs.rows[0];
    },
    all: async (...args) => {
      const rs = await db.execute({ sql, args: args.map(mapArg) });
      return rs.rows;
    },
    run: async (...args) => {
      const rs = await db.execute({ sql, args: args.map(mapArg) });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid };
    },
  }),
  exec: async (sql) => {
    return await db.executeMultiple(sql);
  },
  execute: async (...args) => {
    return await db.execute(...args);
  },
  executeMultiple: async (...args) => {
    return await db.executeMultiple(...args);
  },
  batch: async (...args) => {
    return await db.batch(...args);
  },
};

export default dbWrapper;

/** Close the underlying libsql connection. Call this in test teardown to release file handles. */
export const closeDb = () => db.close();

globalThis.__wishboardDbLoaded = true;
