import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockClient = {
  execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
  executeMultiple: vi.fn().mockResolvedValue({}),
};

let mockLocalClient = {
  execute: vi.fn().mockResolvedValue({
    rows: [
      {
        id: '1',
        username: 'test-user',
        passphrase_hash: 'h',
        passphrase_salt: 's',
        role: 'user',
        created_at: 'now',
      },
    ],
    rowsAffected: 0,
  }),
};

vi.mock('@libsql/client', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createClient: (options) => {
      if (process.env.DATABASE_URL?.startsWith('http')) {
        if (options.url.startsWith('file:')) {
          return mockLocalClient;
        }
        return mockClient;
      }
      return original.createClient(options);
    },
  };
});

describe('db initialization', () => {
  let db;

  beforeEach(async () => {
    // We must reset modules to force re-evaluation of db.js
    vi.resetModules();
    db = (await import('./db.js')).default;
  });

  it('creates tables', async () => {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('wishes');
    expect(tableNames).toContain('wishmails');
  });

  it('ensures all expected columns are added to users table', async () => {
    const columns = await db.prepare('PRAGMA table_info(users)').all();
    const columnNames = columns.map((c) => c.name);

    // Base columns
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('username');
    expect(columnNames).toContain('passphrase_hash');
    expect(columnNames).toContain('passphrase_salt');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('created_at');

    // Ensured columns
    expect(columnNames).toContain('identity_attributes');
    expect(columnNames).toContain('contacts');
    expect(columnNames).toContain('wishmail_enabled');
    expect(columnNames).toContain('is_active');
  });

  it('ensures all expected columns are added to wishes table', async () => {
    const columns = await db.prepare('PRAGMA table_info(wishes)').all();
    const columnNames = columns.map((c) => c.name);

    // Ensured columns
    expect(columnNames).toContain('creator_attributes');
    expect(columnNames).toContain('desired_attributes');
    expect(columnNames).toContain('contacts');
    expect(columnNames).toContain('wishmail_enabled');
    expect(columnNames).toContain('is_active');
  });

  it('ensures default admin account exists', async () => {
    const admin = await db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
    expect(admin).toBeDefined();
    expect(admin.username).toBe('admin');
  });

  it('does not duplicate admin account if it already exists', async () => {
    // Import normally
    const existingDb = (await import('./db.js')).default;

    // There should only be one admin account
    const admins = await existingDb.prepare("SELECT * FROM users WHERE role = 'admin'").all();
    expect(admins.length).toBe(1);

    // If we call ensureDefaultAdmin again by re-importing, it should still be 1
    vi.resetModules();
    const nextDb = (await import('./db.js')).default;
    const nextAdmins = await nextDb.prepare("SELECT * FROM users WHERE role = 'admin'").all();
    expect(nextAdmins.length).toBe(1);
  });

  it('dbWrapper methods wrap db.execute calls correctly', async () => {
    const rs1 = await db.prepare('SELECT ? as val').get(true);
    expect(rs1.val).toBe(1); // boolean maps to 1

    const rs2 = await db.prepare('SELECT ? as val').get(undefined);
    expect(rs2.val).toBeNull(); // undefined maps to null

    const rs3 = await db.prepare('SELECT 1 as val').all();
    expect(rs3[0].val).toBe(1);

    const rs4 = await db.prepare('UPDATE users SET is_active = ? WHERE role = ?').run(1, 'admin');
    expect(rs4.changes).toBeDefined();

    const rs5 = await db.exec('PRAGMA foreign_keys = ON');
    expect(rs5).toBeUndefined();
  });

  it('migrates legacy local database to remote database', async () => {
    const originalUrl = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;

    process.env.DATABASE_URL = 'http://localhost:8080';
    process.env.NODE_ENV = 'production';

    const mockExecute = vi.fn().mockResolvedValue({
      rows: [],
      rowsAffected: 1,
    });
    mockClient.batch = vi.fn().mockResolvedValue([]);
    mockClient.execute = mockExecute;

    const mockLocalExecute = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '1',
          username: 'test-user',
          passphrase_hash: 'h',
          passphrase_salt: 's',
          role: 'user',
          created_at: 'now',
        },
      ],
    });
    mockLocalClient.execute = mockLocalExecute;

    const fs = await import('node:fs');
    const existsSpy = vi.spyOn(fs.default, 'existsSync').mockImplementation((p) => {
      if (p.includes('wishboard.db')) return true;
      if (p.includes('.migrated_to_libsql')) return false;
      return true;
    });
    const writeSpy = vi.spyOn(fs.default, 'writeFileSync').mockImplementation(() => {});

    vi.resetModules();
    await import('./db.js');

    expect(mockLocalExecute).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalled();

    const localCalls = mockLocalExecute.mock.calls.map(([arg]) =>
      typeof arg === 'string' ? arg : arg.sql
    );
    const _remoteCalls = mockExecute.mock.calls.map(([arg]) =>
      typeof arg === 'string' ? arg : arg.sql
    );

    expect(localCalls.some((c) => c.includes('SELECT * FROM'))).toBe(true);
    const remoteBatchCalls = mockClient.batch.mock.calls;
    expect(remoteBatchCalls.length).toBeGreaterThan(0);
    const firstBatchStmt = remoteBatchCalls[0][0][0]; // first call, first arg (array), first element
    expect(firstBatchStmt.sql).toContain('INSERT OR IGNORE INTO');
    expect(writeSpy).toHaveBeenCalled();

    // Restore with delete-if-undefined: `process.env.X = undefined` coerces to
    // the string 'undefined', which would poison DATABASE_URL for later tests.
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    existsSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('does not crash on boot when the remote driver rejects connection PRAGMAs', async () => {
    // Regression: a remote libSQL/sqld server rejects `PRAGMA foreign_keys` /
    // `PRAGMA busy_timeout` as an "unsupported statement". These must be applied
    // individually and best-effort so a rejection can't abort schema init.
    const originalUrl = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = 'http://localhost:8080';
    process.env.NODE_ENV = 'production';

    const executeMultiple = vi.fn().mockResolvedValue({});
    const execute = vi.fn().mockImplementation((arg) => {
      const sql = typeof arg === 'string' ? arg : arg.sql;
      // sqld's Hrana parser rejects the connection-setting PRAGMAs (but not
      // read pragmas like PRAGMA table_info that ensureColumn relies on).
      if (/^\s*PRAGMA\s+(foreign_keys|busy_timeout)/i.test(sql)) {
        return Promise.reject(new Error('SQL_PARSE_ERROR: unsupported statement'));
      }
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    });
    mockClient.execute = execute;
    mockClient.executeMultiple = executeMultiple;

    const fs = await import('node:fs');
    // No legacy DB → skip the migration branch entirely.
    const existsSpy = vi.spyOn(fs.default, 'existsSync').mockReturnValue(false);

    vi.resetModules();
    // Must resolve (module init must not throw) despite every PRAGMA rejecting.
    await expect(import('./db.js')).resolves.toBeDefined();

    // The table DDL still ran, and the PRAGMAs were attempted one-by-one
    // (not inside the executeMultiple sequence, which is what used to abort).
    expect(executeMultiple).toHaveBeenCalled();
    const pragmaCalls = execute.mock.calls
      .map(([a]) => (typeof a === 'string' ? a : a.sql))
      .filter((s) => /^\s*PRAGMA\s+(foreign_keys|busy_timeout)/i.test(s));
    expect(pragmaCalls.length).toBe(2);

    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    existsSpy.mockRestore();
  });
});
