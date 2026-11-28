import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Captures for the module-boundary mocks. db.js resolves its client, optional
// SSM token, pragmas, schema, and default admin entirely at import time, so
// each test re-imports it under a controlled environment.
const h = vi.hoisted(() => ({
  createClientCalls: [],
  clients: [],
  ssmClientArgs: [],
  ssmCommands: [],
  ssmResponse: { Parameter: { Value: 'ssm-resolved-token' } },
  pragmaFailures: new Set(),
  tableInfoRows: {},
  adminRows: [],
}));

vi.mock('@libsql/client', () => ({
  createClient: (config) => {
    h.createClientCalls.push(config);
    const calls = { execute: [], executeMultiple: [], batch: [] };
    const client = {
      calls,
      execute: vi.fn(async (arg) => {
        calls.execute.push(arg);
        const sql = typeof arg === 'string' ? arg : arg.sql;
        if (h.pragmaFailures.has(sql)) {
          throw new Error('unsupported statement');
        }
        if (sql.startsWith('PRAGMA table_info(')) {
          const table = sql.slice('PRAGMA table_info('.length, -1);
          return { rows: h.tableInfoRows[table] || [], rowsAffected: 0 };
        }
        if (sql.startsWith('SELECT id FROM users WHERE role = ?')) {
          return { rows: h.adminRows, rowsAffected: 0 };
        }
        return { rows: [{ id: 'row-1' }], rowsAffected: 3, lastInsertRowid: 42 };
      }),
      executeMultiple: vi.fn(async (sql) => {
        calls.executeMultiple.push(sql);
      }),
      batch: vi.fn(async (stmts, mode) => {
        calls.batch.push([stmts, mode]);
        return [];
      }),
      close: vi.fn(),
    };
    h.clients.push(client);
    return client;
  },
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    constructor(args) {
      h.ssmClientArgs.push(args);
    }
    async send(command) {
      h.ssmCommands.push(command);
      return h.ssmResponse;
    }
  },
  GetParameterCommand: class {
    constructor(input) {
      this.input = input;
    }
  },
}));

const ENV_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'WISHBOARD_DB_PATH',
  'DATABASE_AUTH_TOKEN',
  'DATABASE_AUTH_TOKEN_SSM',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'WISHBOARD_DB_WAL',
  'AWS_LAMBDA_FUNCTION_NAME',
  'WISHBOARD_ADMIN_USERNAME',
  'WISHBOARD_ADMIN_SECRET',
];

let savedEnv;
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  h.createClientCalls.length = 0;
  h.clients.length = 0;
  h.ssmClientArgs.length = 0;
  h.ssmCommands.length = 0;
  h.ssmResponse = { Parameter: { Value: 'ssm-resolved-token' } };
  h.pragmaFailures = new Set();
  h.tableInfoRows = {};
  h.adminRows = [];
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

const importDb = () => import('./db.js');
const mainClient = () => h.clients[0];
const executedSql = () =>
  mainClient().calls.execute.map((a) => (typeof a === 'string' ? a : a.sql));

describe('db init: URL resolution', () => {
  it('test env with no path and no DATABASE_URL falls back to in-memory', async () => {
    process.env.NODE_ENV = 'test';
    await importDb();
    expect(h.createClientCalls[0]).toEqual({ url: 'file::memory:' });
  });

  it('test env honors an explicit WISHBOARD_DB_PATH instead of forcing memory', async () => {
    process.env.NODE_ENV = 'test';
    process.env.WISHBOARD_DB_PATH = '/tmp/explicit.db';
    await importDb();
    expect(h.createClientCalls[0]).toEqual({ url: 'file:/tmp/explicit.db' });
  });

  it('a :memory: path maps to file::memory: in any environment', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WISHBOARD_DB_PATH = ':memory:';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await importDb();
    expect(h.createClientCalls[0]).toEqual({ url: 'file::memory:' });
  });

  it('DATABASE_URL wins and no local file path is derived', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'libsql://db.example.com';
    process.env.WISHBOARD_DB_PATH = '/tmp/ignored.db';
    await importDb();
    expect(h.createClientCalls[0]).toEqual({ url: 'libsql://db.example.com' });
  });
});

describe('db init: auth token resolution', () => {
  it('passes an explicit DATABASE_AUTH_TOKEN and never touches SSM', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'libsql://db.example.com';
    process.env.DATABASE_AUTH_TOKEN = 'explicit-token';
    process.env.DATABASE_AUTH_TOKEN_SSM = '/wishboard/db-token';
    await importDb();
    expect(h.createClientCalls[0]).toEqual({
      url: 'libsql://db.example.com',
      authToken: 'explicit-token',
    });
    expect(h.ssmClientArgs).toHaveLength(0);
  });

  it('resolves the token from SSM with the default region and no profile key', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'libsql://db.example.com';
    process.env.DATABASE_AUTH_TOKEN_SSM = '/wishboard/db-token';
    await importDb();
    expect(h.ssmClientArgs).toEqual([{ region: 'us-east-1' }]);
    expect(h.ssmCommands).toHaveLength(1);
    expect(h.ssmCommands[0].input).toEqual({
      Name: '/wishboard/db-token',
      WithDecryption: true,
    });
    expect(h.createClientCalls[0]).toEqual({
      url: 'libsql://db.example.com',
      authToken: 'ssm-resolved-token',
    });
  });

  it('AWS_REGION beats AWS_DEFAULT_REGION and AWS_PROFILE is spread in when set', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_AUTH_TOKEN_SSM = '/wishboard/db-token';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';
    process.env.AWS_PROFILE = 'deploy-profile';
    await importDb();
    expect(h.ssmClientArgs).toEqual([{ region: 'eu-west-1', profile: 'deploy-profile' }]);
  });

  it('falls back to AWS_DEFAULT_REGION when AWS_REGION is unset', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_AUTH_TOKEN_SSM = '/wishboard/db-token';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';
    await importDb();
    expect(h.ssmClientArgs).toEqual([{ region: 'us-west-2' }]);
  });

  it('omits authToken entirely when SSM returns no parameter value', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'libsql://db.example.com';
    process.env.DATABASE_AUTH_TOKEN_SSM = '/wishboard/db-token';
    h.ssmResponse = {};
    await importDb();
    expect(h.createClientCalls[0]).toEqual({ url: 'libsql://db.example.com' });
  });
});

describe('db init: pragmas, WAL, and schema', () => {
  it('applies both connection pragmas in order before the schema', async () => {
    process.env.NODE_ENV = 'test';
    await importDb();
    expect(executedSql().slice(0, 2)).toEqual([
      'PRAGMA foreign_keys = ON',
      'PRAGMA busy_timeout = 5000',
    ]);
  });

  it('warns with the exact message and continues when a pragma is unsupported', async () => {
    process.env.NODE_ENV = 'test';
    h.pragmaFailures = new Set(['PRAGMA foreign_keys = ON']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await importDb();
    expect(warn).toHaveBeenCalledWith(
      'Skipping unsupported "PRAGMA foreign_keys = ON" on this database driver: unsupported statement'
    );
    expect(executedSql()).toContain('PRAGMA busy_timeout = 5000');
    expect(mainClient().calls.executeMultiple).toHaveLength(1);
  });

  it('enables WAL only with the flag, a file URL, no Lambda, and not :memory:', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WISHBOARD_DB_PATH = '/tmp/wal.db';
    process.env.WISHBOARD_DB_WAL = '1';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await importDb();
    expect(executedSql()).toContain('PRAGMA journal_mode = WAL');
  });

  it('does not enable WAL without the flag', async () => {
    process.env.NODE_ENV = 'test';
    process.env.WISHBOARD_DB_PATH = '/tmp/wal.db';
    await importDb();
    expect(executedSql()).not.toContain('PRAGMA journal_mode = WAL');
  });

  it('does not enable WAL on Lambda even with the flag', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WISHBOARD_DB_PATH = '/tmp/wal.db';
    process.env.WISHBOARD_DB_WAL = '1';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'api-fn';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await importDb();
    expect(executedSql()).not.toContain('PRAGMA journal_mode = WAL');
  });

  it('does not enable WAL for an in-memory database', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WISHBOARD_DB_PATH = ':memory:';
    process.env.WISHBOARD_DB_WAL = '1';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await importDb();
    expect(executedSql()).not.toContain('PRAGMA journal_mode = WAL');
  });

  it('creates the schema with the exact table definitions', async () => {
    process.env.NODE_ENV = 'test';
    await importDb();
    const schema = mainClient().calls.executeMultiple[0];
    for (const fragment of [
      'CREATE TABLE IF NOT EXISTS users (',
      'username TEXT UNIQUE NOT NULL',
      "role TEXT NOT NULL DEFAULT 'user'",
      'CREATE TABLE IF NOT EXISTS sessions (',
      'FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE',
      'CREATE TABLE IF NOT EXISTS wishes (',
      'flagged INTEGER DEFAULT 0',
      'FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL',
      'CREATE TABLE IF NOT EXISTS wishmails (',
      'CREATE TABLE IF NOT EXISTS websocket_connections (',
      'CREATE TABLE IF NOT EXISTS wish_ai_suggestions (',
      "status TEXT NOT NULL DEFAULT 'pending'",
      'CREATE TABLE IF NOT EXISTS wish_embeddings (',
    ]) {
      expect(schema).toContain(fragment);
    }
  });

  it('adds every missing column with its exact definition, in order', async () => {
    process.env.NODE_ENV = 'test';
    await importDb();
    const alters = executedSql().filter((s) => s.startsWith('ALTER TABLE'));
    expect(alters).toEqual([
      'ALTER TABLE users ADD COLUMN identity_attributes TEXT',
      'ALTER TABLE users ADD COLUMN contacts TEXT',
      'ALTER TABLE users ADD COLUMN wishmail_enabled INTEGER DEFAULT 0',
      'ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1',
      'ALTER TABLE users ADD COLUMN ui_preferences TEXT DEFAULT \'{"themeMode":"host-default"}\'',
      'ALTER TABLE wishes ADD COLUMN creator_attributes TEXT',
      'ALTER TABLE wishes ADD COLUMN desired_attributes TEXT',
      'ALTER TABLE wishes ADD COLUMN contacts TEXT',
      'ALTER TABLE wishes ADD COLUMN wishmail_enabled INTEGER DEFAULT 0',
      'ALTER TABLE wishes ADD COLUMN is_active INTEGER DEFAULT 1',
      'ALTER TABLE wishes ADD COLUMN image_id TEXT',
      'ALTER TABLE wishes ADD COLUMN card_style TEXT',
      'ALTER TABLE wish_ai_suggestions ADD COLUMN suggested_content TEXT',
      'ALTER TABLE websocket_connections ADD COLUMN user_id TEXT',
      'ALTER TABLE websocket_connections ADD COLUMN sub_syslog INTEGER DEFAULT 0',
      'ALTER TABLE websocket_connections ADD COLUMN sub_wishes INTEGER DEFAULT 0',
      'ALTER TABLE websocket_connections ADD COLUMN sub_wish_id TEXT',
    ]);
  });

  it('skips the ALTER for a column that already exists', async () => {
    process.env.NODE_ENV = 'test';
    h.tableInfoRows = {
      users: [{ name: 'contacts' }],
      wishes: [],
      wish_ai_suggestions: [],
      websocket_connections: [],
    };
    await importDb();
    const alters = executedSql().filter((s) => s.startsWith('ALTER TABLE'));
    expect(alters).not.toContain('ALTER TABLE users ADD COLUMN contacts TEXT');
    expect(alters).toContain('ALTER TABLE users ADD COLUMN identity_attributes TEXT');
  });
});

describe('db init: default admin seeding', () => {
  it('inserts the default admin with a scrypt hash when no admin exists', async () => {
    process.env.NODE_ENV = 'test';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await importDb();
    const insert = mainClient().calls.execute.find(
      (a) => typeof a === 'object' && a.sql.startsWith('INSERT INTO users')
    );
    expect(insert.sql).toBe(
      'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const [id, username, hash, salt, role, createdAt] = insert.args;
    expect(id).toMatch(/^admin-[0-9a-f]{8}$/);
    expect(username).toBe('admin');
    expect(hash).toMatch(/^[0-9a-f]{128}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(role).toBe('admin');
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
    // Test mode stays quiet about the seeded credentials.
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Created default admin'));
  });

  it('honors WISHBOARD_ADMIN_USERNAME and announces creation outside test mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WISHBOARD_ADMIN_USERNAME = 'root-admin';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await importDb();
    const insert = mainClient().calls.execute.find(
      (a) => typeof a === 'object' && a.sql.startsWith('INSERT INTO users')
    );
    expect(insert.args[1]).toBe('root-admin');
    expect(log).toHaveBeenCalledWith('Created default admin account: root-admin');
    expect(log).toHaveBeenCalledWith('Set WISHBOARD_ADMIN_SECRET to change the default password.');
  });

  it('does not insert when an admin already exists', async () => {
    process.env.NODE_ENV = 'test';
    h.adminRows = [{ id: 'existing-admin' }];
    await importDb();
    const inserts = mainClient().calls.execute.filter(
      (a) => typeof a === 'object' && a.sql.startsWith('INSERT INTO users')
    );
    expect(inserts).toHaveLength(0);
  });
});

describe('db wrapper and mapArg', () => {
  it('mapArg maps undefined to null, booleans to 1/0, and passes the rest through', async () => {
    process.env.NODE_ENV = 'test';
    const { mapArg } = await importDb();
    expect(mapArg(undefined)).toBeNull();
    expect(mapArg(true)).toBe(1);
    expect(mapArg(false)).toBe(0);
    expect(mapArg(0)).toBe(0);
    expect(mapArg('x')).toBe('x');
    expect(mapArg(null)).toBeNull();
  });

  it('prepare().get/all/run map args and shape results from the raw client', async () => {
    process.env.NODE_ENV = 'test';
    const mod = await importDb();
    const db = mod.default;
    const stmt = db.prepare('SELECT * FROM wishes WHERE is_active = ? AND flagged = ?');
    await expect(stmt.get(true, false)).resolves.toEqual({ id: 'row-1' });
    await expect(stmt.all(true, false)).resolves.toEqual([{ id: 'row-1' }]);
    await expect(stmt.run(true, false)).resolves.toEqual({ changes: 3, lastInsertRowid: 42 });
    const select = mainClient().calls.execute.find(
      (a) => typeof a === 'object' && a.sql.startsWith('SELECT * FROM wishes')
    );
    expect(select.args).toEqual([1, 0]);
  });
});
