/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import { describe, expect, it } from 'vitest';
const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const db = (await import('../db.js')).default;
const app = appModule.default;

afterEach(async () => {
  await db.exec('DELETE FROM sessions');
  await db.exec('DELETE FROM wishes');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
});

describe('User registration and login', () => {
  it('registers with blank passphrase and returns a generated secret', async () => {
    const response = await request(app)
      .post('/api/users/register')
      .send({ username: 'user1' })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.secret).toBeTypeOf('string');
    expect(response.body.secret.length).toBeGreaterThan(0);
  });

  it('reports username existence', async () => {
    await request(app)
      .post('/api/users/register')
      .send({ username: 'user5', passphrase: 'secret' })
      .set('Accept', 'application/json');

    const existsResponse = await request(app).get('/api/users/exists').query({ username: 'user5' });
    expect(existsResponse.status).toBe(200);
    expect(existsResponse.body.exists).toBe(true);

    const missingResponse = await request(app)
      .get('/api/users/exists')
      .query({ username: 'unknown' });
    expect(missingResponse.status).toBe(200);
    expect(missingResponse.body.exists).toBe(false);
  });

  it('registers with explicit passphrase and stores it correctly', async () => {
    const register = await request(app)
      .post('/api/users/register')
      .send({ username: 'user2', passphrase: 'mysecret' })
      .set('Accept', 'application/json');

    expect(register.status).toBe(200);
    expect(register.body.secret).toBe('mysecret');
    expect(register.body.token).toBeTypeOf('string');
  });

  it('logs in with an existing user and correct passphrase', async () => {
    await request(app)
      .post('/api/users/register')
      .send({ username: 'user3', passphrase: 'correcthorsebatterystaple' })
      .set('Accept', 'application/json');

    const login = await request(app)
      .post('/api/users/login')
      .send({ username: 'user3', passphrase: 'correcthorsebatterystaple' })
      .set('Accept', 'application/json');

    expect(login.status).toBe(200);
    expect(login.body.token).toBeTypeOf('string');
    expect(login.body.username).toBe('user3');
  });

  it('updates authenticated user attributes', async () => {
    const register = await request(app)
      .post('/api/users/register')
      .send({ username: 'user6', passphrase: 'updateme' })
      .set('Accept', 'application/json');

    const token = register.body.token;
    const update = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        identity_attributes: {
          gender: ['non-binary'],
          orientation: ['pansexual'],
          role: ['mentor'],
        },
      })
      .set('Accept', 'application/json');

    expect(update.status).toBe(200);
    expect(update.body.identity_attributes.gender).toEqual(['non-binary']);
    expect(update.body.identity_attributes.orientation).toEqual(['pansexual']);
    expect(update.body.identity_attributes.role).toEqual(['mentor']);

    // Fetch me
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.identity_attributes.gender).toEqual(['non-binary']);
    expect(me.body.identity_attributes.orientation).toEqual(['pansexual']);
    expect(me.body.identity_attributes.role).toEqual(['mentor']);
  });

  it('rejects login when existing user supplies an incorrect passphrase', async () => {
    await request(app)
      .post('/api/users/register')
      .send({ username: 'user4', passphrase: 'rightpass' })
      .set('Accept', 'application/json');

    const login = await request(app)
      .post('/api/users/login')
      .send({ username: 'user4', passphrase: 'wrongpass' })
      .set('Accept', 'application/json');

    expect(login.status).toBe(401);
    expect(login.body.error).toBe('Invalid username or passphrase.');
  });

  it('persists identity attributes provided during registration', async () => {
    const register = await request(app)
      .post('/api/users/register')
      .send({
        username: 'test_register_user',
        passphrase: 'secure_password_here',
        identity_attributes: { gender: ['woman'], orientation: ['bisexual'], role: ['switch'] },
      })
      .set('Accept', 'application/json');

    expect(register.status).toBe(200);
    expect(register.body.identity_attributes.gender).toEqual(['woman']);
    expect(register.body.identity_attributes.orientation).toEqual(['bisexual']);
    expect(register.body.identity_attributes.role).toEqual(['switch']);

    const login = await request(app).post('/api/users/login').send({
      username: 'test_register_user',
      passphrase: 'secure_password_here',
    });

    expect(login.status).toBe(200);
    expect(login.body.token).toBeTypeOf('string');
    expect(login.body.identity_attributes.gender).toEqual(['woman']);
    expect(login.body.identity_attributes.orientation).toEqual(['bisexual']);
    expect(login.body.identity_attributes.role).toEqual(['switch']);

    // Also verify via direct DB query for belt-and-suspenders
    const row = await db
      .prepare('SELECT identity_attributes FROM users WHERE username = ?')
      .get('test_register_user');
    const identityAttrs = JSON.parse(row.identity_attributes);
    expect(identityAttrs.gender).toEqual(['woman']);
    expect(identityAttrs.orientation).toEqual(['bisexual']);
    expect(identityAttrs.role).toEqual(['switch']);
  });
  it('handles missing usernames in /exists and /register', async () => {
    const exists = await request(app).get('/api/users/exists');
    expect(exists.status).toBe(400);

    const register = await request(app).post('/api/users/register').send({});
    expect(register.status).toBe(400);
  });

  it('handles registering an already existing username', async () => {
    await request(app).post('/api/users/register').send({ username: 'duplicate' });
    const duplicate = await request(app)
      .post('/api/users/register')
      .send({ username: 'duplicate' });
    expect(duplicate.status).toBe(409);
  });

  it('handles missing credentials in /login', async () => {
    const login1 = await request(app).post('/api/users/login').send({ username: 'u' });
    expect(login1.status).toBe(400);

    const login2 = await request(app).post('/api/users/login').send({ passphrase: 'p' });
    expect(login2.status).toBe(400);
  });

  it('handles unauthenticated requests to protected endpoints', async () => {
    const putMe = await request(app).put('/api/users/me').send({});
    expect(putMe.status).toBe(401);

    const getMe = await request(app).get('/api/users/me');
    expect(getMe.status).toBe(401);

    const getWishes = await request(app).get('/api/users/me/wishes');
    expect(getWishes.status).toBe(401);
  });

  it('handles logout by deleting the session', async () => {
    const register = await request(app)
      .post('/api/users/register')
      .send({ username: 'logoutuser' });
    const token = register.body.token;

    const logout = await request(app)
      .post('/api/users/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const getMe = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(getMe.status).toBe(401);
  });

  describe('profile attribute conflict validation', () => {
    it('returns 400 when registering with conflicting attributes', async () => {
      const res = await request(app)
        .post('/api/users/register')
        .send({
          username: 'conflict_reg',
          passphrase: 'password123',
          identity_attributes: { gender: ['man'], orientation: ['lesbian'] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed: Profile attributes conflict');
    });

    it('returns 400 when updating profile with conflicting attributes', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'conflict_upd', passphrase: 'password123' });

      const res = await request(app)
        .put('/api/users/me')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({
          identity_attributes: { gender: ['man'], orientation: ['lesbian'] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed: Profile attributes conflict');
    });
  });

  describe('account deletion, preview, and activation state management', () => {
    it('fetches delete preview counts and allows normal user self-deletion', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'delete_me_user', passphrase: 'password123' });
      const token = reg.body.token;

      const preview = await request(app)
        .get('/api/users/me/delete-preview')
        .set('Authorization', `Bearer ${token}`);

      expect(preview.status).toBe(200);
      expect(preview.body.wishesCount).toBe(0);
      expect(preview.body.wishmailsCount).toBe(0);

      const del = await request(app)
        .post('/api/users/me/delete')
        .set('Authorization', `Bearer ${token}`);

      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);

      const getMe = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
      expect(getMe.status).toBe(401);
    });

    it('prevents deletion of the sole admin user', async () => {
      const adminLogin = await request(app)
        .post('/api/users/login')
        .send({ username: 'admin', passphrase: 'admin-board' });

      const token = adminLogin.body.token;

      const del = await request(app)
        .post('/api/users/me/delete')
        .set('Authorization', `Bearer ${token}`);

      expect(del.status).toBe(403);
      expect(del.body.error).toBe('Cannot delete the last admin user.');
    });

    it('allows deactivating and reactivating a user account', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'active_toggle_user', passphrase: 'password123' });
      const token = reg.body.token;

      const deact = await request(app)
        .post('/api/users/me/deactivate')
        .set('Authorization', `Bearer ${token}`);
      expect(deact.status).toBe(200);
      expect(deact.body.success).toBe(true);

      const react = await request(app)
        .post('/api/users/me/reactivate')
        .set('Authorization', `Bearer ${token}`);
      expect(react.status).toBe(200);
      expect(react.body.success).toBe(true);
    });

    it('returns user wishes list with unread wishmail count and card_style', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'wishes_list_user', passphrase: 'password123' });
      const token = reg.body.token;

      await request(app)
        .post('/api/wishes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'My styled user wish',
          card_style: { paperColor: 'canary', pinColor: 'emerald' },
        });

      const wishes = await request(app)
        .get('/api/users/me/wishes')
        .set('Authorization', `Bearer ${token}`);

      expect(wishes.status).toBe(200);
      expect(Array.isArray(wishes.body)).toBe(true);
      expect(wishes.body.length).toBe(1);
      expect(wishes.body[0].card_style).toEqual({ paperColor: 'canary', pinColor: 'emerald' });
    });

    it('persists and updates UI preferences on registration and PUT /api/users/me', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({
          username: 'ui_pref_user',
          passphrase: 'password123',
          ui_preferences: { themeMode: 'corkhouse', defaultCardColor: 'canary' },
        });

      expect(reg.status).toBe(200);
      expect(reg.body.ui_preferences).toEqual({
        themeMode: 'corkhouse',
        defaultCardColor: 'canary',
      });
      const token = reg.body.token;

      // GET /me
      const meRes = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.ui_preferences.themeMode).toBe('corkhouse');

      // Update via PUT /me
      const putRes = await request(app)
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ui_preferences: { themeMode: 'daylight', defaultPinColor: 'sapphire' },
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.ui_preferences.themeMode).toBe('daylight');
      expect(putRes.body.ui_preferences.defaultPinColor).toBe('sapphire');

      // Login returns updated ui_preferences
      const loginRes = await request(app)
        .post('/api/users/login')
        .send({ username: 'ui_pref_user', passphrase: 'password123' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.ui_preferences.themeMode).toBe('daylight');

      // Update with invalid themeMode falls back to host-default
      const invalidRes = await request(app)
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ui_preferences: { themeMode: 'invalid-mode' },
        });

      expect(invalidRes.status).toBe(200);
      expect(invalidRes.body.ui_preferences.themeMode).toBe('host-default');
    });
  });

  describe('PUT /api/users/me/passphrase', () => {
    it('requires authentication', async () => {
      const res = await request(app)
        .put('/api/users/me/passphrase')
        .send({ current_passphrase: 'old', new_passphrase: 'new' });

      expect(res.status).toBe(401);
    });

    it('validates required fields', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'pw_change_user', passphrase: 'initial-passphrase' });
      const token = reg.body.token;

      const resNoCurrent = await request(app)
        .put('/api/users/me/passphrase')
        .set('Authorization', `Bearer ${token}`)
        .send({ new_passphrase: 'new-passphrase' });
      expect(resNoCurrent.status).toBe(400);

      const resNoNew = await request(app)
        .put('/api/users/me/passphrase')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_passphrase: 'initial-passphrase' });
      expect(resNoNew.status).toBe(400);
    });

    it('rejects incorrect current passphrase', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'pw_wrong_curr', passphrase: 'correct-current' });
      const token = reg.body.token;

      const res = await request(app)
        .put('/api/users/me/passphrase')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_passphrase: 'wrong-current', new_passphrase: 'brand-new-pass' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid current passphrase/i);
    });

    it('successfully changes passphrase and enables login with new passphrase', async () => {
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'pw_success_user', passphrase: 'first-passphrase' });
      const token = reg.body.token;

      const changeRes = await request(app)
        .put('/api/users/me/passphrase')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_passphrase: 'first-passphrase', new_passphrase: 'second-passphrase' });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.success).toBe(true);

      // Old passphrase no longer works
      const oldLogin = await request(app)
        .post('/api/users/login')
        .send({ username: 'pw_success_user', passphrase: 'first-passphrase' });
      expect(oldLogin.status).toBe(401);

      // New passphrase works
      const newLogin = await request(app)
        .post('/api/users/login')
        .send({ username: 'pw_success_user', passphrase: 'second-passphrase' });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.token).toBeTypeOf('string');
    });
  });
});
