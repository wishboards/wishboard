/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const db = (await import('../db.js')).default;
const app = appModule.default;

const defaultAdminUsername = 'admin';
const defaultAdminSecret = 'admin-board';

const clearTestData = async () => {
  await db.exec('DELETE FROM sessions');
  await db.exec('DELETE FROM wishes');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
};

beforeEach(async () => {
  await clearTestData();
});

afterEach(async () => {
  await clearTestData();
});

describe('Admin routes coverage', () => {
  const loginAsAdmin = async () => {
    const response = await request(app)
      .post('/api/users/login')
      .send({ username: defaultAdminUsername, passphrase: defaultAdminSecret })
      .set('Accept', 'application/json');
    return response.body.token;
  };

  it('handles not found errors for clearing single flag', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .post('/api/admin/wishes/non-existent/clear-flag')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Wish not found.');
  });

  it('handles CloudWatch errors during logs read in serverless mode', async () => {
    const originalEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-function';

    const mockCloudWatchLogsClient = {
      send: vi.fn().mockRejectedValue(new Error('Mock CloudWatch Error')),
    };

    // We have to mock the client before it's imported in the route, but since it's lazy-loaded:
    vi.doMock('@aws-sdk/client-cloudwatch-logs', () => ({
      CloudWatchLogsClient: vi.fn(() => mockCloudWatchLogsClient),
      GetLogEventsCommand: vi.fn(),
    }));

    const token = await loginAsAdmin();
    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Failed to read CloudWatch logs');

    if (originalEnv === undefined) {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    } else {
      process.env.AWS_LAMBDA_FUNCTION_NAME = originalEnv;
    }
    vi.doUnmock('@aws-sdk/client-cloudwatch-logs');
  });

  it('handles errors during reset-password and calls next(error)', async () => {
    const token = await loginAsAdmin();

    // Register a user to trigger reset
    await request(app)
      .post('/api/users/register')
      .send({ username: 'reset-error-user', passphrase: 'pwd' });

    const originalPrepare = await db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('UPDATE users SET passphrase_hash = ?')) {
        throw new Error('Mock error');
      }
      return originalPrepare(sql);
    });

    const response = await request(app)
      .post(`/api/admin/users/reset-error-user/reset-password`)
      .set('Authorization', `Bearer ${token}`);

    // next(error) in Express will usually render a 500 HTML page or error JSON depending on the handler
    expect(response.status).toBe(500);

    spy.mockRestore();
  });

  describe('reset-password API', () => {
    it('generates a new passphrase if omitted', async () => {
      const token = await loginAsAdmin();
      await request(app)
        .post('/api/users/register')
        .send({ username: 'reset-api-user-1', passphrase: 'pwd' });

      const response = await request(app)
        .post(`/api/admin/users/reset-api-user-1/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.new_passphrase).toBeDefined();
    });

    it('uses provided passphrase if given', async () => {
      const token = await loginAsAdmin();
      await request(app)
        .post('/api/users/register')
        .send({ username: 'reset-api-user-2', passphrase: 'pwd' });

      const response = await request(app)
        .post(`/api/admin/users/reset-api-user-2/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passphrase: 'new-custom-pass' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.new_passphrase).toBe('new-custom-pass');
    });

    it('returns 404 for non-existent user', async () => {
      const token = await loginAsAdmin();
      const response = await request(app)
        .post(`/api/admin/users/non-existent-id/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found.');
    });
  });

  it('returns delete preview stats correctly', async () => {
    const token = await loginAsAdmin();
    const registerRes = await request(app)
      .post('/api/users/register')
      .send({ username: 'delete-preview-user', passphrase: 'pwd' });
    const userId = registerRes.body.id;

    await db
      .prepare(
        'INSERT INTO wishes (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('preview-wish', userId, 'test', new Date().toISOString(), new Date().toISOString());

    const response = await request(app)
      .get(`/api/admin/users/${userId}/delete-preview`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ wishesCount: 1, wishmailsCount: 0 });
  });

  it('rejects demo reset in production without force', async () => {
    const token = await loginAsAdmin();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const response = await request(app)
      .post('/api/admin/reset-demo')
      .send({})
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      'Demo reset is disabled in production unless force is explicitly requested.'
    );

    process.env.NODE_ENV = originalEnv;
  });

  it('allows demo reset in production with force', async () => {
    const token = await loginAsAdmin();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const response = await request(app)
      .post('/api/admin/reset-demo')
      .send({ force: true })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    process.env.NODE_ENV = originalEnv;
  });

  it('reads logs successfully', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('logs');
  });

  it('parses and formats logs successfully', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const logsDir = path.join(process.cwd(), 'data/logs');

    // Ensure logs directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Create a temporary log file
    const testLogFile = path.join(logsDir, 'test-formatting.log');
    const logsContent = [
      JSON.stringify({
        timestamp: '2026-01-01',
        level: 'info',
        message: 'Hello world',
        userId: 123,
      }),
      JSON.stringify({ timestamp: '2026-01-01', level: 'warn', message: 'Warning msg' }),
      JSON.stringify({ message: 'Only message' }),
      'Raw non-JSON log line',
    ].join('\n');

    fs.writeFileSync(testLogFile, logsContent, 'utf-8');
    const futureTime = new Date(Date.now() + 1000000);
    fs.utimesSync(testLogFile, futureTime, futureTime);

    try {
      const token = await loginAsAdmin();
      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.logs).toContain('[2026-01-01] info: Hello world {"userId":123}');
      expect(response.body.logs).toContain('[2026-01-01] warn: Warning msg');
      expect(response.body.logs).toContain('[] : Only message');
      expect(response.body.logs).toContain('Raw non-JSON log line');
    } finally {
      // Clean up
      if (fs.existsSync(testLogFile)) {
        fs.unlinkSync(testLogFile);
      }
    }
  });

  it('sorts multiple log files and reads the newest one', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const logsDir = path.join(process.cwd(), 'data/logs');

    fs.mkdirSync(logsDir, { recursive: true });

    const log1 = path.join(logsDir, 'test1.log');
    const log2 = path.join(logsDir, 'test2.log');

    fs.writeFileSync(log1, 'log1 content', 'utf-8');
    fs.writeFileSync(log2, 'log2 content', 'utf-8');

    // Ensure log2 is the newest file overall by giving it a future date
    const futureTime = new Date(Date.now() + 1000000);
    fs.utimesSync(log2, futureTime, futureTime);

    // Make log2 newer
    const now = new Date();
    fs.utimesSync(log1, now, now);
    const later = new Date(now.getTime() + 1000);
    fs.utimesSync(log2, later, later);

    try {
      const token = await loginAsAdmin();
      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.logs).toContain('log2 content');
    } finally {
      if (fs.existsSync(log1)) fs.unlinkSync(log1);
      if (fs.existsSync(log2)) fs.unlinkSync(log2);
    }
  });

  it('handles fs errors during logs read', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const logsDir = path.join(process.cwd(), 'data/logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const badLog = path.join(logsDir, 'bad.log');
    // Make it a directory so readFileSync throws EISDIR
    fs.mkdirSync(badLog, { recursive: true });

    // Ensure badLog is the newest file
    const futureTime = new Date(Date.now() + 1000000);
    fs.utimesSync(badLog, futureTime, futureTime);

    try {
      const token = await loginAsAdmin();
      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to read logs');
    } finally {
      fs.rmdirSync(badLog);
    }
  });

  it('returns config successfully', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .get('/api/admin/config')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('isProduction');
  });

  describe('reset-rules API', () => {
    it('rejects requests from non-admin users (401)', async () => {
      const response = await request(app).post('/api/admin/reset-rules').send({});
      expect(response.status).toBe(401);
    });

    it('rejects requests in production mode unless force is set (403)', async () => {
      const token = await loginAsAdmin();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const response = await request(app)
          .post('/api/admin/reset-rules')
          .set('Authorization', `Bearer ${token}`)
          .send({});
        expect(response.status).toBe(403);
        expect(response.body.error).toContain('force is explicitly requested');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('allows resetting in production mode when force is true', async () => {
      const token = await loginAsAdmin();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const response = await request(app)
          .post('/api/admin/reset-rules')
          .set('Authorization', `Bearer ${token}`)
          .send({ force: true });
        expect(response.status).toBe(200);
        expect(response.body.message).toContain('Matching rules successfully reset');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('resets rules in non-production successfully and syncs cache', async () => {
      const token = await loginAsAdmin();

      // Insert a dummy rule first to verify it gets cleared
      await db
        .prepare(
          `
        INSERT INTO rules (id, rule_type, trigger_attribute, trigger_value, target_attribute, target_value)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run('temp-rule-id', 'expansion', 'gender', 'dummy', 'gender', 'dummy-target');

      // Verify dummy rule is in the DB
      let count = (
        await db.prepare('SELECT COUNT(*) AS count FROM rules WHERE id = ?').get('temp-rule-id')
      ).count;
      expect(count).toBe(1);

      // Perform reset-rules request
      const response = await request(app)
        .post('/api/admin/reset-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.rules_count).toBeGreaterThan(0);

      // Verify dummy rule is cleared and default rules exist in DB
      count = (
        await db.prepare('SELECT COUNT(*) AS count FROM rules WHERE id = ?').get('temp-rule-id')
      ).count;
      expect(count).toBe(0);

      const rulesCount = (await db.prepare('SELECT COUNT(*) AS count FROM rules').get()).count;
      expect(rulesCount).toBe(response.body.rules_count);

      // Verify cache reloading by checking if the loaded rules are exposed synchronously via rulesManager
      const { getRules } = await import('../rulesManager.js');
      const cachedRules = getRules();
      expect(cachedRules.length).toBe(rulesCount);
      expect(cachedRules.some((r) => r.id === 'temp-rule-id')).toBe(false);
    });

    it('handles database errors gracefully and returns 500', async () => {
      const token = await loginAsAdmin();
      const originalPrepare = await db.prepare.bind(db);
      const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('DELETE FROM rules')) {
          throw new Error('Mock DB delete error');
        }
        return originalPrepare(sql);
      });

      try {
        const response = await request(app)
          .post('/api/admin/reset-rules')
          .set('Authorization', `Bearer ${token}`)
          .send({});
        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Internal Server Error during rules reset');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('POST & DELETE /api/admin/proposals/test-seed', () => {
    it('returns 404 outside NODE_ENV=test', async () => {
      const token = await loginAsAdmin();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const postRes = await request(app)
          .post('/api/admin/proposals/test-seed')
          .set('Authorization', `Bearer ${token}`)
          .send({ proposal_type: 'suggestion', normalized_key: 'prod-blocked' });
        expect(postRes.status).toBe(404);

        const delRes = await request(app)
          .delete('/api/admin/proposals/test-seed')
          .set('Authorization', `Bearer ${token}`)
          .send({});
        expect(delRes.status).toBe(404);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('seeds, increments, validates, and clears proposals in NODE_ENV=test', async () => {
      const token = await loginAsAdmin();
      const badRes = await request(app)
        .post('/api/admin/proposals/test-seed')
        .set('Authorization', `Bearer ${token}`)
        .send({ proposal_type: 'invalid', normalized_key: 'bad' });
      expect(badRes.status).toBe(400);

      const first = await request(app)
        .post('/api/admin/proposals/test-seed')
        .set('Authorization', `Bearer ${token}`)
        .send({
          proposal_type: 'suggestion',
          normalized_key: 'test_seed_key',
          proposed_payload: { categoryId: 'interests', term: 'test_seed_key' },
          occurrence_count: 1,
        });
      expect(first.status).toBe(200);
      expect(first.body.proposal.occurrence_count).toBe(1);

      const second = await request(app)
        .post('/api/admin/proposals/test-seed')
        .set('Authorization', `Bearer ${token}`)
        .send({
          proposal_type: 'suggestion',
          normalized_key: 'test_seed_key',
          proposed_payload: { categoryId: 'interests', term: 'test_seed_key' },
          occurrence_count: 2,
        });
      expect(second.status).toBe(200);
      expect(second.body.proposal.occurrence_count).toBe(3);

      const delRes = await request(app)
        .delete('/api/admin/proposals/test-seed')
        .set('Authorization', `Bearer ${token}`)
        .send({ normalizedKeys: ['test_seed_key'] });
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });
  });
});
