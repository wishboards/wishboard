/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import { describe, expect, it, afterEach } from 'vitest';
const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const db = (await import('../db.js')).default;
const app = appModule.default;

afterEach(async () => {
  await db.exec('DELETE FROM wishmails');
  await db.exec('DELETE FROM wish_ai_suggestions');
  await db.exec('DELETE FROM wishes');
  await db.exec('DELETE FROM sessions');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
});

const register = (body) =>
  request(app).post('/api/users/register').send(body).set('Accept', 'application/json');
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('users routes: exact responses', () => {
  it('register returns the exact response shape with defaults applied', async () => {
    const res = await register({ username: 'exact_shape', passphrase: 'pw' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'contacts',
      'id',
      'identity_attributes',
      'is_active',
      'role',
      'secret',
      'token',
      'ui_preferences',
      'username',
      'wishmail_enabled',
    ]);
    expect(res.body.id).toMatch(/^[a-z0-9]{8}$/);
    expect(res.body.username).toBe('exact_shape');
    expect(res.body.role).toBe('user');
    expect(res.body.is_active).toBe(true);
    expect(res.body.secret).toBe('pw');
    expect(res.body.contacts).toEqual([]);
    expect(res.body.wishmail_enabled).toBe(false);
    expect(res.body.identity_attributes).toEqual({});
    expect(res.body.ui_preferences).toEqual({ themeMode: 'host-default' });
  });

  it('register trims the passphrase and echoes contacts and wishmail flag exactly', async () => {
    const res = await register({
      username: 'trim_pass',
      passphrase: '  spaced pass  ',
      contacts: [{ type: 'Email', value: 'a@b.c' }],
      wishmail_enabled: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.secret).toBe('spaced pass');
    expect(res.body.contacts).toEqual([{ type: 'Email', value: 'a@b.c' }]);
    expect(res.body.wishmail_enabled).toBe(true);
    const login = await request(app)
      .post('/api/users/login')
      .send({ username: 'trim_pass', passphrase: 'spaced pass' });
    expect(login.status).toBe(200);
  });

  it('duplicate registration is a 409 with the exact error body', async () => {
    await register({ username: 'dup_user', passphrase: 'pw' });
    const res = await register({ username: 'dup_user', passphrase: 'other' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Username already exists.' });
  });

  it('exists returns the exact boolean body', async () => {
    await register({ username: 'exists_user', passphrase: 'pw' });
    const yes = await request(app).get('/api/users/exists').query({ username: 'exists_user' });
    expect(yes.body).toEqual({ exists: true });
    const no = await request(app).get('/api/users/exists').query({ username: 'ghost_user' });
    expect(no.body).toEqual({ exists: false });
  });
});

describe('users routes: ui_preferences sanitizing', () => {
  it.each(['host-default', 'midnight', 'daylight', 'corkhouse', 'high-contrast'])(
    'keeps the valid theme mode %s',
    async (mode) => {
      const res = await register({
        username: `theme_${mode}`,
        passphrase: 'pw',
        ui_preferences: { themeMode: mode },
      });
      expect(res.status).toBe(200);
      expect(res.body.ui_preferences).toEqual({ themeMode: mode });
    }
  );

  it('falls back to host-default for an unknown mode and for non-object input', async () => {
    const bogus = await register({
      username: 'theme_bogus',
      passphrase: 'pw',
      ui_preferences: { themeMode: 'bogus' },
    });
    expect(bogus.body.ui_preferences).toEqual({ themeMode: 'host-default' });
    const nonObject = await register({
      username: 'theme_string',
      passphrase: 'pw',
      ui_preferences: 'midnight',
    });
    expect(nonObject.body.ui_preferences).toEqual({ themeMode: 'host-default' });
  });

  it('trims card/pin colors and drops blank or non-string colors', async () => {
    const trimmed = await register({
      username: 'color_trim',
      passphrase: 'pw',
      ui_preferences: { defaultCardColor: '  crimson  ', defaultPinColor: ' gold ' },
    });
    expect(trimmed.body.ui_preferences).toEqual({
      themeMode: 'host-default',
      defaultCardColor: 'crimson',
      defaultPinColor: 'gold',
    });
    const dropped = await register({
      username: 'color_drop',
      passphrase: 'pw',
      ui_preferences: { defaultCardColor: '   ', defaultPinColor: 42 },
    });
    expect(dropped.body.ui_preferences).toEqual({ themeMode: 'host-default' });
  });

  it('PUT /me merges new preferences over the stored ones and re-sanitizes', async () => {
    const reg = await register({
      username: 'merge_user',
      passphrase: 'pw',
      ui_preferences: { themeMode: 'midnight', defaultCardColor: 'red' },
    });
    const token = reg.body.token;
    const put = await request(app)
      .put('/api/users/me')
      .set(auth(token))
      .send({ ui_preferences: { defaultPinColor: 'gold' } });
    expect(put.status).toBe(200);
    expect(put.body.ui_preferences).toEqual({
      themeMode: 'midnight',
      defaultCardColor: 'red',
      defaultPinColor: 'gold',
    });
    const noPrefs = await request(app).put('/api/users/me').set(auth(token)).send({});
    expect(noPrefs.body.ui_preferences).toEqual({
      themeMode: 'midnight',
      defaultCardColor: 'red',
      defaultPinColor: 'gold',
    });
    const bogus = await request(app)
      .put('/api/users/me')
      .set(auth(token))
      .send({ ui_preferences: { themeMode: 'bogus' } });
    expect(bogus.body.ui_preferences.themeMode).toBe('host-default');
    expect(bogus.body.ui_preferences.defaultCardColor).toBe('red');
  });
});

describe('users routes: auth guard, login, passphrase', () => {
  it('rejects unauthenticated /me access with the exact 401 body', async () => {
    const get = await request(app).get('/api/users/me');
    expect(get.status).toBe(401);
    expect(get.body).toEqual({ error: 'Not authenticated.' });
    const put = await request(app).put('/api/users/me').send({});
    expect(put.status).toBe(401);
    expect(put.body).toEqual({ error: 'Not authenticated.' });
  });

  it('login failures share the exact 401 body for bad password and unknown user', async () => {
    await register({ username: 'login_user', passphrase: 'right' });
    const badPass = await request(app)
      .post('/api/users/login')
      .send({ username: 'login_user', passphrase: 'wrong' });
    expect(badPass.status).toBe(401);
    expect(badPass.body).toEqual({ error: 'Invalid username or passphrase.' });
    const unknown = await request(app)
      .post('/api/users/login')
      .send({ username: 'no_such', passphrase: 'right' });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: 'Invalid username or passphrase.' });
  });

  it('passphrase change: exact error, exact success, old passphrase dies', async () => {
    const reg = await register({ username: 'pw_user', passphrase: 'oldpass' });
    const token = reg.body.token;
    const wrong = await request(app)
      .put('/api/users/me/passphrase')
      .set(auth(token))
      .send({ current_passphrase: 'nope', new_passphrase: 'newpass' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'Invalid current passphrase.' });
    const ok = await request(app)
      .put('/api/users/me/passphrase')
      .set(auth(token))
      .send({ current_passphrase: 'oldpass', new_passphrase: 'newpass' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, message: 'Passphrase changed successfully.' });
    const oldLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'pw_user', passphrase: 'oldpass' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'pw_user', passphrase: 'newpass' });
    expect(newLogin.status).toBe(200);
  });

  it('logout deletes the session and always succeeds', async () => {
    const reg = await register({ username: 'logout_user', passphrase: 'pw' });
    const token = reg.body.token;
    const out = await request(app).post('/api/users/logout').set(auth(token));
    expect(out.body).toEqual({ success: true });
    const me = await request(app).get('/api/users/me').set(auth(token));
    expect(me.status).toBe(401);
    const anon = await request(app).post('/api/users/logout');
    expect(anon.status).toBe(200);
    expect(anon.body).toEqual({ success: true });
  });
});

describe('users routes: wishes list, delete preview, delete, activation', () => {
  const seedWish = async (userId, id, createdAt, extra = {}) => {
    await db
      .prepare(
        'INSERT INTO wishes (id, user_id, content, contacts, wishmail_enabled, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        userId,
        extra.content || `Wish ${id}`,
        JSON.stringify(extra.contacts || []),
        extra.wishmail ? 1 : 0,
        1,
        createdAt,
        createdAt
      );
  };

  it('GET /me/wishes formats rows exactly and orders newest first', async () => {
    const reg = await register({ username: 'list_user', passphrase: 'pw' });
    const { id: userId, token } = reg.body;
    await seedWish(userId, 'w-old', '2026-01-01T00:00:00.000Z');
    await seedWish(userId, 'w-new', '2026-02-01T00:00:00.000Z', {
      contacts: [{ type: 'Email', value: 'x@y.z' }],
      wishmail: true,
    });
    await db
      .prepare(
        'INSERT INTO wishmails (id, wish_id, content, read, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('m1', 'w-new', 'hello', 0, '2026-02-02T00:00:00.000Z');
    await db
      .prepare(
        'INSERT INTO wish_ai_suggestions (id, wish_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('s1', 'w-new', 'pending', '2026-02-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
    const res = await request(app).get('/api/users/me/wishes').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.map((w) => w.id)).toEqual(['w-new', 'w-old']);
    const [first] = res.body;
    expect(first.contacts).toEqual([{ type: 'Email', value: 'x@y.z' }]);
    expect(first.wishmail_enabled).toBe(true);
    expect(first.is_active).toBe(true);
    expect(first.unread_wishmail_count).toBe(1);
    expect(first.pending_suggestions_count).toBe(1);
    expect(first.has_ai_suggestions).toBe(true);
    expect(res.body[1].unread_wishmail_count).toBe(0);
    expect(res.body[1].has_ai_suggestions).toBe(false);
  });

  it('delete-preview returns exact counts', async () => {
    const reg = await register({ username: 'preview_user', passphrase: 'pw' });
    const { id: userId, token } = reg.body;
    await seedWish(userId, 'wp-1', '2026-01-01T00:00:00.000Z');
    await seedWish(userId, 'wp-2', '2026-01-02T00:00:00.000Z');
    const mail = db.prepare(
      'INSERT INTO wishmails (id, wish_id, content, read, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    await mail.run('mp-1', 'wp-1', 'a', 0, '2026-01-03T00:00:00.000Z');
    await mail.run('mp-2', 'wp-1', 'b', 1, '2026-01-03T00:00:00.000Z');
    await mail.run('mp-3', 'wp-2', 'c', 0, '2026-01-03T00:00:00.000Z');
    const res = await request(app).get('/api/users/me/delete-preview').set(auth(token));
    expect(res.body).toEqual({ wishesCount: 2, wishmailsCount: 3 });
  });

  it('self-delete removes the account and its wishes; the last admin is protected', async () => {
    const reg = await register({ username: 'delete_user', passphrase: 'pw' });
    const { id: userId, token } = reg.body;
    await seedWish(userId, 'wd-1', '2026-01-01T00:00:00.000Z');
    const del = await request(app).post('/api/users/me/delete').set(auth(token));
    expect(del.body).toEqual({ success: true });
    const exists = await request(app).get('/api/users/exists').query({ username: 'delete_user' });
    expect(exists.body).toEqual({ exists: false });
    const remaining = await db.prepare('SELECT id FROM wishes WHERE user_id = ?').all(userId);
    expect(remaining).toHaveLength(0);

    const adminLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'admin', passphrase: 'admin-board' });
    expect(adminLogin.status).toBe(200);
    const adminDel = await request(app)
      .post('/api/users/me/delete')
      .set(auth(adminLogin.body.token));
    expect(adminDel.status).toBe(403);
    expect(adminDel.body).toEqual({ error: 'Cannot delete the last admin user.' });
  });

  it('deactivate and reactivate flip is_active in the database', async () => {
    const reg = await register({ username: 'active_user', passphrase: 'pw' });
    const { id: userId, token } = reg.body;
    const off = await request(app).post('/api/users/me/deactivate').set(auth(token));
    expect(off.body).toEqual({ success: true });
    let row = await db.prepare('SELECT is_active FROM users WHERE id = ?').get(userId);
    expect(row.is_active).toBe(0);
    const on = await request(app).post('/api/users/me/reactivate').set(auth(token));
    expect(on.body).toEqual({ success: true });
    row = await db.prepare('SELECT is_active FROM users WHERE id = ?').get(userId);
    expect(row.is_active).toBe(1);
  });
});
