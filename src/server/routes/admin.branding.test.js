import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import { createSessionToken } from '../auth.js';

describe('Admin Branding Endpoints', () => {
  let adminToken = '';
  let userToken = '';

  beforeEach(async () => {
    // Clean settings
    await db.prepare('DELETE FROM settings WHERE key LIKE ?').run('branding:%');

    // Create an admin user & a regular user
    const adminId = 'admin-branding-test';
    const userId = 'regular-user-test';

    await db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, passphrase_hash, passphrase_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(adminId, 'admin_brand', 'hash', 'salt', 'admin', new Date().toISOString());

    await db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, passphrase_hash, passphrase_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(userId, 'regular_brand', 'hash', 'salt', 'user', new Date().toISOString());

    adminToken = await createSessionToken(adminId);
    userToken = await createSessionToken(userId);
  });

  describe('GET /api/admin/branding', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/branding');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users with 403', async () => {
      const res = await request(app)
        .get('/api/admin/branding')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('returns default branding for admin', async () => {
      const res = await request(app)
        .get('/api/admin/branding')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('themePreset');
      expect(res.body).toHaveProperty('accentColor');
      expect(res.body).toHaveProperty('boardTitle');
    });
  });

  describe('PUT /api/admin/branding', () => {
    it('updates branding and returns success with updated config', async () => {
      const res = await request(app)
        .put('/api/admin/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          themePreset: 'corkhouse',
          accentColor: '#10b981',
          primaryColor: '#059669',
          boardTitle: 'Custom Event Board',
          boardTexture: 'linen',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.branding.themePreset).toBe('corkhouse');
      expect(res.body.branding.accentColor).toBe('#10b981');
      expect(res.body.branding.primaryColor).toBe('#059669');
      expect(res.body.branding.boardTitle).toBe('Custom Event Board');
      expect(res.body.branding.boardTexture).toBe('linen');
    });
  });

  describe('DELETE /api/admin/branding', () => {
    it('resets branding overrides to profile defaults', async () => {
      await request(app)
        .put('/api/admin/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ boardTitle: 'Overridden Board' });

      const res = await request(app)
        .delete('/api/admin/branding')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.branding.boardTitle).not.toBe('Overridden Board');
    });
  });

  describe('POST /api/admin/branding/upload', () => {
    it('rejects uploads without a file with 400', async () => {
      const res = await request(app)
        .post('/api/admin/branding/upload')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No image file uploaded');
    });

    it('rejects SVG and forbidden file formats with 400', async () => {
      const res = await request(app)
        .post('/api/admin/branding/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from('<svg></svg>'), 'logo.svg');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only PNG, JPG, and WEBP are allowed');
    });

    it('accepts valid PNG image and returns file url', async () => {
      const dummyPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89,
      ]);

      const res = await request(app)
        .post('/api/admin/branding/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', dummyPng, 'logo.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.url).toMatch(/^\/images\/branding-.*\.png$/);
    });
  });
});
