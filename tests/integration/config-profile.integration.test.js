/** @vitest-environment node */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-cfgtest-'));
const dbFile = path.join(tmpDir, 'cfg.db');

process.env.NODE_ENV = 'test';
process.env.WISHBOARD_DB_PATH = dbFile;

const request = (await import('supertest')).default;
const app = (await import('../../src/server/index.js')).default;
const { stopWatchingRules } = await import('../../src/server/rulesManager.js');

afterAll(async () => {
  stopWatchingRules?.();
  const { closeDb } = await import('../../src/server/db.js');
  await closeDb();
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
});

describe('integration: event profile configuration contract', () => {
  it('serves the active event profile from real filesystem YAML config via /api/config', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);

    const body = res.body;
    expect(body.profile).toBeDefined();
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories.length).toBeGreaterThan(0);

    // Verify categories schema structure
    for (const cat of body.categories) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('label');
      expect(Array.isArray(cat.suggestions)).toBe(true);
    }

    // Verify contact methods and stickers
    expect(Array.isArray(body.contact_methods)).toBe(true);
    expect(body.contact_methods.length).toBeGreaterThan(0);
    expect(body.stickers).toBeDefined();
  });

  it('merges DB profile overrides into GET /api/config and sanitizes SVG stickers', async () => {
    const { setProfileOverride, clearProfileOverrides } =
      await import('../../src/server/configManager.js');

    await setProfileOverride('suggestions', {
      orientation: ['Demiromantic'],
    });
    await setProfileOverride('stickers', {
      orientation: {
        demiromantic: {
          type: 'svg',
          svg: '<svg viewBox="0 0 24 24" onclick="alert(1)"><circle cx="12" cy="12" r="10" fill="#10b981" /></svg>',
        },
        malicious: {
          type: 'svg',
          svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
        },
      },
    });

    try {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);

      const orientationCat = res.body.categories.find((c) => c.id === 'orientation');
      expect(orientationCat.suggestions).toContain('Demiromantic');

      expect(res.body.stickers.orientation.demiromantic).toEqual({
        type: 'svg',
        svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#10b981" /></svg>',
      });
      expect(res.body.stickers.orientation.malicious).toBeUndefined();
    } finally {
      await clearProfileOverrides();
    }
  });

  it('PUT and DELETE /api/admin/profile-overrides enforce admin auth, validate/sanitize payloads, and invalidate cache immediately', async () => {
    const adminLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'admin', passphrase: process.env.WISHBOARD_ADMIN_SECRET || 'admin-board' });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token;

    await request(app)
      .post('/api/users/register')
      .send({ username: 'regular-cfg-user', passphrase: 'apple-river-forest' });
    const userLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'regular-cfg-user', passphrase: 'apple-river-forest' });
    const userToken = userLogin.body.token;

    // 1. Auth checks
    const unauthPut = await request(app).put('/api/admin/profile-overrides').send({});
    expect(unauthPut.status).toBe(401);

    const nonAdminPut = await request(app)
      .put('/api/admin/profile-overrides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(nonAdminPut.status).toBe(403);

    // 2. Reject invalid SVG and invalid payload shapes (400) without partial writes
    const badSvgRes = await request(app)
      .put('/api/admin/profile-overrides')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categories: [{ id: 'role', label: 'Role', suggestions: ['ShouldNotPersist'] }],
        stickers: {
          role: {
            bad: { type: 'svg', svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>' },
          },
        },
      });
    expect(badSvgRes.status).toBe(400);

    const badShapeRes = await request(app)
      .put('/api/admin/profile-overrides')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categories: 'not-an-array' });
    expect(badShapeRes.status).toBe(400);

    const badImgRes = await request(app)
      .put('/api/admin/profile-overrides')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stickers: {
          role: { badimg: { type: 'image', src: 'https://evil.example/x.png' } },
        },
      });
    expect(badImgRes.status).toBe(400);

    // Warm the 60s cache before writing valid override
    const beforeCfg = await request(app).get('/api/config');
    expect(beforeCfg.status).toBe(200);
    const roleBefore = beforeCfg.body.categories.find((c) => c.id === 'role');
    expect(roleBefore.suggestions).not.toContain('ShouldNotPersist');

    try {
      // 3. Valid PUT sanitizes SVG and invalidates cache immediately
      const putRes = await request(app)
        .put('/api/admin/profile-overrides')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categories: [{ id: 'role', label: 'Role', suggestions: ['CacheBustRole'] }],
          suggestions: { orientation: ['CacheBustOrientation'] },
          stickers: {
            role: {
              cachebust: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24" onclick="alert(1)"><circle cx="12" cy="12" r="8" fill="#10b981"/></svg>',
              },
            },
          },
        });
      expect(putRes.status).toBe(200);
      expect(putRes.body.success).toBe(true);
      expect(putRes.body.stickers.role.cachebust.svg).toBe(
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#10b981" /></svg>'
      );

      const afterPutCfg = await request(app).get('/api/config');
      expect(afterPutCfg.status).toBe(200);
      expect(afterPutCfg.body.categories.find((c) => c.id === 'role').suggestions).toContain(
        'CacheBustRole'
      );
      expect(afterPutCfg.body.categories.find((c) => c.id === 'orientation').suggestions).toContain(
        'CacheBustOrientation'
      );
      expect(afterPutCfg.body.stickers.role.cachebust.svg).toBe(
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#10b981" /></svg>'
      );

      // 4. DELETE clears overrides and invalidates cache immediately
      const delRes = await request(app)
        .delete('/api/admin/profile-overrides')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      const afterDelCfg = await request(app).get('/api/config');
      expect(afterDelCfg.status).toBe(200);
      expect(afterDelCfg.body.categories.find((c) => c.id === 'role').suggestions).not.toContain(
        'CacheBustRole'
      );
      expect(afterDelCfg.body.stickers.role?.cachebust).toBeUndefined();
    } finally {
      await request(app)
        .delete('/api/admin/profile-overrides')
        .set('Authorization', `Bearer ${adminToken}`);
    }
  });
});
