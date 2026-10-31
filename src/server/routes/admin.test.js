/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCloudWatchLogsSend = vi.fn();
function MockCloudWatchLogsClient(config) {
  this.config = config;
  this.send = mockCloudWatchLogsSend;
}
function MockFilterLogEventsCommand(args) {
  this.args = args;
}
vi.mock('@aws-sdk/client-cloudwatch-logs', () => {
  return {
    CloudWatchLogsClient: MockCloudWatchLogsClient,
    FilterLogEventsCommand: MockFilterLogEventsCommand,
  };
});

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

let originalLambdaName;

beforeEach(async () => {
  await clearTestData();
  originalLambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});

afterEach(async () => {
  await clearTestData();
  if (originalLambdaName === undefined) {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  } else {
    process.env.AWS_LAMBDA_FUNCTION_NAME = originalLambdaName;
  }
});

describe('Admin routes', () => {
  const loginAsAdmin = async () => {
    const response = await request(app)
      .post('/api/users/login')
      .send({ username: defaultAdminUsername, passphrase: defaultAdminSecret })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    return response.body.token;
  };

  it('rejects admin routes without a valid session (401)', async () => {
    const response = await request(app).get('/api/admin/flags');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication required.');
  });

  it('lists flagged wishes and allows removal by admin', async () => {
    const wishId = 'flagged-wish-1';
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO wishes (id, user_id, content, secret_hash, creator_attributes, desired_attributes, created_at, updated_at, flagged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        wishId,
        null,
        'Please remove me',
        null,
        JSON.stringify({}),
        JSON.stringify({}),
        now,
        now,
        1
      );

    const token = await loginAsAdmin();

    const flagsResponse = await request(app)
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${token}`);

    expect(flagsResponse.status).toBe(200);
    expect(flagsResponse.body).toEqual([
      expect.objectContaining({ id: wishId, content: 'Please remove me', flagged: 1 }),
    ]);

    const removeResponse = await request(app)
      .post(`/api/admin/wishes/${wishId}/remove`)
      .set('Authorization', `Bearer ${token}`);

    expect(removeResponse.status).toBe(200);
    expect(removeResponse.body).toEqual({ success: true });

    const flagsAfterRemoval = await request(app)
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${token}`);

    expect(flagsAfterRemoval.status).toBe(200);
    expect(flagsAfterRemoval.body).toEqual([]);
  });

  it('allows admin to clear flags individually and in bulk', async () => {
    const wishId1 = 'flagged-wish-1';
    const wishId2 = 'flagged-wish-2';
    const now = new Date().toISOString();
    const insertWish = async (id) => {
      await db
        .prepare(
          `INSERT INTO wishes (id, user_id, content, secret_hash, creator_attributes, desired_attributes, created_at, updated_at, flagged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, null, 'Content ' + id, null, JSON.stringify({}), JSON.stringify({}), now, now, 1);
    };

    await insertWish(wishId1);
    await insertWish(wishId2);

    const token = await loginAsAdmin();

    // 1. Clear single flag
    const clearOneResponse = await request(app)
      .post(`/api/admin/wishes/${wishId1}/clear-flag`)
      .set('Authorization', `Bearer ${token}`);
    expect(clearOneResponse.status).toBe(200);
    expect(clearOneResponse.body).toEqual({ success: true });

    // Check flagged list - only wishId2 should be flagged
    let flagsResponse = await request(app)
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${token}`);
    expect(flagsResponse.status).toBe(200);
    expect(flagsResponse.body.length).toBe(1);
    expect(flagsResponse.body[0].id).toBe(wishId2);

    // 2. Set wishId1 flagged status back to 1 to test bulk clear
    await db.prepare('UPDATE wishes SET flagged = 1 WHERE id = ?').run(wishId1);

    // Clear all flags in bulk
    const clearAllResponse = await request(app)
      .post('/api/admin/wishes/clear-all-flags')
      .set('Authorization', `Bearer ${token}`);
    expect(clearAllResponse.status).toBe(200);
    expect(clearAllResponse.body).toEqual({ success: true });

    // Check flagged list - should be empty
    flagsResponse = await request(app)
      .get('/api/admin/flags')
      .set('Authorization', `Bearer ${token}`);
    expect(flagsResponse.status).toBe(200);
    expect(flagsResponse.body).toEqual([]);
  });

  it('lists users, updates roles, and deletes user accounts', async () => {
    const registerResponse = await request(app)
      .post('/api/users/register')
      .send({ username: 'test-admin-flow', passphrase: 'password' })
      .set('Accept', 'application/json');

    expect(registerResponse.status).toBe(200);
    const testUserId = registerResponse.body.id;

    const token = await loginAsAdmin();

    const usersResponse = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body.some((user) => user.username === 'test-admin-flow')).toBe(true);

    const promoteResponse = await request(app)
      .post(`/api/admin/users/${testUserId}/role`)
      .send({ role: 'admin' })
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json');

    expect(promoteResponse.status).toBe(200);
    expect(promoteResponse.body).toEqual({ success: true });

    const updatedUsers = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(updatedUsers.body.find((user) => user.id === testUserId).role).toBe('admin');

    const deleteResponse = await request(app)
      .post(`/api/admin/users/${testUserId}/delete`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ success: true });

    const usersAfterDelete = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(usersAfterDelete.body.some((user) => user.id === testUserId)).toBe(false);
  }, 15000);

  it('resets the demo environment and returns the correct stats', async () => {
    await db
      .prepare('INSERT INTO wishes (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('preseed-wish', 'Leave me behind', new Date().toISOString(), new Date().toISOString());

    const token = await loginAsAdmin();

    const resetResponse = await request(app)
      .post('/api/admin/reset-demo')
      .set('Authorization', `Bearer ${token}`);

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body).toEqual({
      message: 'Demo environment successfully seeded.',
      stats: { usersCreated: 50, wishesCreated: 100 },
    });

    const usersCount = (
      await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role != 'admin'").get()
    ).count;
    const adminCount = (
      await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()
    ).count;
    const wishesCount = (await db.prepare('SELECT COUNT(*) AS count FROM wishes').get()).count;

    expect(usersCount).toBe(50);
    expect(adminCount).toBe(1);
    expect(wishesCount).toBe(101); // 100 generated + 1 preserved
  }, 15000);

  it('handles not found errors for removing wishes', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .post('/api/admin/wishes/non-existent/remove')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Wish not found.');
  });

  it('handles invalid roles when updating user role', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .post('/api/admin/users/123/role')
      .send({ role: 'invalid' })
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Role must be user or admin.');
  });

  it('handles not found errors for updating user role', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .post('/api/admin/users/non-existent/role')
      .send({ role: 'admin' })
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('User not found.');
  });

  it('handles not found errors for deleting users', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .post('/api/admin/users/non-existent/delete')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('User not found.');
  });

  describe('reset password', () => {
    it('rejects non-admin users', async () => {
      const res = await request(app).post('/api/admin/users/testuser/reset-password').send({});
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown user', async () => {
      const adminToken = await loginAsAdmin();
      const res = await request(app)
        .post('/api/admin/users/unknown/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it('resets a password with a generated passphrase', async () => {
      await request(app)
        .post('/api/users/register')
        .send({ username: 'resetme', passphrase: 'pw' });

      const adminToken = await loginAsAdmin();
      const res = await request(app)
        .post('/api/admin/users/resetme/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.new_passphrase).toBeDefined();
      expect(res.body.new_passphrase).not.toBe('pw');
    });

    it('resets a password with a provided passphrase', async () => {
      await request(app)
        .post('/api/users/register')
        .send({ username: 'resetme2', passphrase: 'pw' });

      const adminToken = await loginAsAdmin();
      const res = await request(app)
        .post('/api/admin/users/resetme2/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ passphrase: 'new-password-123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.new_passphrase).toBe('new-password-123');
    });
  });

  it('refuses to delete the account the admin is signed in as', async () => {
    const token = await loginAsAdmin();
    const admin = await db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(defaultAdminUsername);

    const response = await request(app)
      .post(`/api/admin/users/${admin.id}/delete`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/signed in as/);
    // The signed-in admin must still exist.
    const stillThere = await db.prepare('SELECT id FROM users WHERE id = ?').get(admin.id);
    expect(stillThere).toBeTruthy();
  });

  it('marks admin responses no-store so stale privileged responses are never cached', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('handles errors during demo reset', async () => {
    const token = await loginAsAdmin();
    const spy = vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('Mock error'));

    const response = await request(app)
      .post('/api/admin/reset-demo')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal Server Error during seeding');

    spy.mockRestore();
  });

  it('allows admin to reset a user passphrase', async () => {
    // 1. Register a test user
    const registerResponse = await request(app)
      .post('/api/users/register')
      .send({ username: 'test-reset-user', passphrase: 'old-password' })
      .set('Accept', 'application/json');

    expect(registerResponse.status).toBe(200);
    const testUserId = registerResponse.body.id;

    // 2. Login as admin
    const adminToken = await loginAsAdmin();

    // 3. Login as test user to create a session
    const loginResponse = await request(app)
      .post('/api/users/login')
      .send({ username: 'test-reset-user', passphrase: 'old-password' })
      .set('Accept', 'application/json');
    expect(loginResponse.status).toBe(200);

    const activeSessionsBefore = (
      await db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(testUserId)
    ).count;
    expect(activeSessionsBefore).toBe(2);

    // 4. Reset password as admin
    const resetResponse = await request(app)
      .post(`/api/admin/users/test-reset-user/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);

    if (resetResponse.status !== 200) console.log(resetResponse.body);
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body.success).toBe(true);
    expect(typeof resetResponse.body.new_passphrase).toBe('string');
    expect(resetResponse.body.new_passphrase.length).toBeGreaterThan(0);

    // 5. Verify sessions were deleted
    const activeSessionsAfter = (
      await db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(testUserId)
    ).count;
    expect(activeSessionsAfter).toBe(0);

    // 6. Verify old password doesn't work
    const oldLoginResponse = await request(app)
      .post('/api/users/login')
      .send({ username: 'test-reset-user', passphrase: 'old-password' })
      .set('Accept', 'application/json');
    expect(oldLoginResponse.status).toBe(401);

    // 7. Verify new password works
    const newLoginResponse = await request(app)
      .post('/api/users/login')
      .send({ username: 'test-reset-user', passphrase: resetResponse.body.new_passphrase })
      .set('Accept', 'application/json');
    expect(newLoginResponse.status).toBe(200);
  });

  it('handles not found errors for resetting password', async () => {
    const adminToken = await loginAsAdmin();
    const response = await request(app)
      .post('/api/admin/users/non-existent-user/reset-password')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('User not found.');
  });

  it('reads the logs successfully and sets no-cache headers', async () => {
    const token = await loginAsAdmin();
    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.logs).toBeDefined();
    expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
    expect(response.headers['pragma']).toBe('no-cache');
  });

  describe('Serverless logs (CloudWatch)', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-lambda-function-express-api';
      process.env.AWS_REGION = 'us-west-2';
      mockCloudWatchLogsSend.mockReset();
    });

    afterEach(() => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = originalEnv;
    });

    it('returns logs from CloudWatch Logs by combining and sorting API and WebSocket log groups', async () => {
      const token = await loginAsAdmin();
      // First call (API group)
      mockCloudWatchLogsSend.mockResolvedValueOnce({
        events: [
          { message: 'START RequestId: 1', timestamp: 1000 },
          { message: 'info: API Log 1', timestamp: 2000 },
          { message: 'REPORT RequestId: 1', timestamp: 4000 },
        ],
      });
      // Second call (WS group)
      mockCloudWatchLogsSend.mockResolvedValueOnce({
        events: [
          { message: 'info: WS Log 1', timestamp: 1500 },
          { message: 'info: WS Log 2', timestamp: 3000 },
        ],
      });

      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.source).toBe('cloudwatch');
      // Should be sorted by timestamp:
      // timestamp 1500: [WS] info: WS Log 1
      // timestamp 2000: info: API Log 1
      // timestamp 3000: [WS] info: WS Log 2
      expect(response.body.logs).toBe('[WS] info: WS Log 1\ninfo: API Log 1\n[WS] info: WS Log 2');
      expect(mockCloudWatchLogsSend).toHaveBeenCalledTimes(2);

      // Verify log groups queried
      const call1LogGroup = mockCloudWatchLogsSend.mock.calls[0][0].args.logGroupName;
      const call2LogGroup = mockCloudWatchLogsSend.mock.calls[1][0].args.logGroupName;
      expect(call1LogGroup).toBe('/aws/lambda/test-lambda-function-express-api');
      expect(call2LogGroup).toBe('/aws/lambda/test-lambda-function-websocket-mgr');
    });

    it('handles failure to query one log group gracefully and returns logs from the other', async () => {
      const token = await loginAsAdmin();
      // First call succeeds
      mockCloudWatchLogsSend.mockResolvedValueOnce({
        events: [{ message: 'info: API Log only', timestamp: 1000 }],
      });
      // Second call fails
      mockCloudWatchLogsSend.mockRejectedValueOnce(new Error('AccessDenied'));

      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.logs).toBe('info: API Log only');
      expect(mockCloudWatchLogsSend).toHaveBeenCalledTimes(2);
    });

    it('handles errors gracefully when both log groups fail and returns 500', async () => {
      const token = await loginAsAdmin();
      mockCloudWatchLogsSend.mockRejectedValue(new Error('AccessDenied'));

      const response = await request(app)
        .get('/api/admin/logs')
        .set('Authorization', `Bearer ${token}`);

      // Since both fail and return empty array, we get "No log entries found in the last hour."
      expect(response.status).toBe(200);
      expect(response.body.logs).toBe('No log entries found in the last hour.');
      expect(mockCloudWatchLogsSend).toHaveBeenCalledTimes(2);
    });
  });

  it('handles missing logs directory', async () => {
    const token = await loginAsAdmin();

    const spyExists = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation(
        (pathStr) =>
          !(
            typeof pathStr === 'string' &&
            (pathStr.includes('data/logs') || pathStr.includes(String.raw`data\logs`))
          )
      );

    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.logs).toBe('Logs directory not found.');

    spyExists.mockRestore();
  });

  it('handles empty logs directory', async () => {
    const token = await loginAsAdmin();

    const spyExists = vi.spyOn(fs, 'existsSync').mockImplementation((pathStr) => {
      return (
        typeof pathStr === 'string' &&
        (pathStr.includes('data/logs') || pathStr.includes(String.raw`data\logs`))
      );
    });
    const spyReadDir = vi.spyOn(fs, 'readdirSync').mockImplementation((pathStr) => {
      const isLogs =
        typeof pathStr === 'string' &&
        (pathStr.includes('data/logs') || pathStr.includes(String.raw`data\logs`));
      return isLogs ? [] : ['not_logs.log'];
    });

    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.logs).toBe('No logs found.');

    spyExists.mockRestore();
    spyReadDir.mockRestore();
  });
});
