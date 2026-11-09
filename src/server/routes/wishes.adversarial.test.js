/** @vitest-environment node */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmpRulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-adversarial-'));
const rulesPath = path.join(tmpRulesDir, 'rules.test.yaml');

process.env.WISHBOARD_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.RULES_PATH = rulesPath;

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const app = appModule.default;
const db = (await import('../db.js')).default;
const { reloadRules, stopWatchingRules } = await import('../rulesManager.js');
const { parseCardStyle, DEFAULT_CARD_STYLE } = await import('./wishes.js');

const clearTestData = async () => {
  await db.exec('DELETE FROM wishmails');
  await db.exec('DELETE FROM wish_exclusions');
  await db.exec('DELETE FROM wishes');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
  await reloadRules();
};

beforeEach(async () => {
  await clearTestData();
});

afterEach(async () => {
  await clearTestData();
});

afterAll(() => {
  stopWatchingRules();
  fs.rmSync(tmpRulesDir, { recursive: true, force: true });
});

describe('Adversarial Stress Testing: card_style', () => {
  // ── Dimension 1: Malformed JSON Payloads ─────────────────────────────────
  describe('Malformed and Type Confusion Payloads (POST /api/wishes)', () => {
    it('rejects number payload for card_style with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: 12345 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects boolean payload for card_style with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: true });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects array payload for card_style with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: ['ivory', 'ruby'] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects empty array payload for card_style with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects non-string paperColor (number) with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: { paperColor: 42, pinColor: 'ruby' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });

    it('rejects non-string pinColor (boolean) with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: { paperColor: 'ivory', pinColor: true } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style pinColor');
    });

    it('rejects null paperColor with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: { paperColor: null, pinColor: 'ruby' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });

    it('rejects null pinColor with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: { paperColor: 'ivory', pinColor: null } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style pinColor');
    });

    it('rejects deeply nested object as paperColor with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({
          content: 'Test wish',
          card_style: { paperColor: { nested: 'canary' }, pinColor: 'ruby' },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });

    it('rejects array as pinColor with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({
          content: 'Test wish',
          card_style: { paperColor: 'ivory', pinColor: ['ruby'] },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style pinColor');
    });

    it('rejects stringified null ("null") or stringified number ("123") in JSON body with HTTP 400', async () => {
      const res1 = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: 'null' });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: '12345' });
      expect(res2.status).toBe(400);
    });

    it('accepts stringified empty object ("{}") in JSON body and defaults colors', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test wish', card_style: '{}' });
      expect(res.status).toBe(201);
      const getRes = await request(app).get(`/api/wishes/${res.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.card_style).toEqual({ paperColor: 'ivory', pinColor: 'ruby' });
    });
  });

  // ── Dimension 2: Boundary and Case Sensitivity Checks ───────────────────
  describe('Boundary and Case Sensitivity Enforcement', () => {
    it('rejects uppercase paper color values with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test uppercase', card_style: { paperColor: 'IVORY' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });

    it('rejects titlecase pin color values with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test titlecase', card_style: { pinColor: 'Ruby' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style pinColor');
    });

    it('rejects whitespace-padded color names with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: 'Test whitespace', card_style: { paperColor: ' rose ' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });

    it('rejects invalid enum color names with HTTP 400', async () => {
      for (const invalidColor of ['black', 'white', 'purple', 'neon-green', 'cyan']) {
        const res = await request(app)
          .post('/api/wishes')
          .send({ content: 'Test invalid', card_style: { paperColor: invalidColor } });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid card_style paperColor');
      }
    });

    it('accepts all 25 valid combinations of allowed paper and pin colors', async () => {
      const papers = ['ivory', 'canary', 'rose', 'sky', 'sage'];
      const pins = ['ruby', 'amber', 'emerald', 'sapphire', 'violet'];

      for (const paper of papers) {
        for (const pin of pins) {
          const res = await request(app)
            .post('/api/wishes')
            .send({
              content: `Comb test ${paper} ${pin}`,
              card_style: { paperColor: paper, pinColor: pin },
            });
          expect(res.status).toBe(201);

          const getRes = await request(app).get(`/api/wishes/${res.body.id}`);
          expect(getRes.status).toBe(200);
          expect(getRes.body.card_style).toEqual({ paperColor: paper, pinColor: pin });
        }
      }
    });
  });

  // ── Dimension 3: Prototype Pollution and Extra Keys Stripping ────────────
  describe('Prototype Pollution and Unknown Property Stripping', () => {
    it('strips extraneous properties and avoids prototype pollution', async () => {
      const pollutedPayload = JSON.parse(
        '{"paperColor":"sky","pinColor":"emerald","isAdmin":true,"__proto__":{"polluted":true},"role":"admin"}'
      );

      const res = await request(app).post('/api/wishes').send({
        content: 'Prototype pollution attempt',
        card_style: pollutedPayload,
      });

      expect(res.status).toBe(201);
      // Ensure global Object prototype is not polluted
      expect({}['polluted']).toBeUndefined();

      // Retrieve wish and verify only paperColor and pinColor are stored / returned
      const getRes = await request(app).get(`/api/wishes/${res.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.card_style).toEqual({ paperColor: 'sky', pinColor: 'emerald' });
      expect(getRes.body.card_style.isAdmin).toBeUndefined();
      expect(getRes.body.card_style.role).toBeUndefined();

      // Verify raw database row has clean JSON without extra fields
      const row = await db.prepare('SELECT card_style FROM wishes WHERE id = ?').get(res.body.id);
      const parsedDb = JSON.parse(row.card_style);
      expect(parsedDb).toEqual({ paperColor: 'sky', pinColor: 'emerald' });
      expect(parsedDb.isAdmin).toBeUndefined();
      expect(parsedDb.role).toBeUndefined();
    });
  });

  // ── Dimension 4: SQL Injection and Oversized Strings ─────────────────────
  describe('SQL Injection and Extreme Payloads', () => {
    it('rejects SQL injection payloads inside card_style color fields with HTTP 400', async () => {
      const injectionAttempts = [
        "ivory'; DROP TABLE wishes; --",
        "' OR '1'='1",
        "ruby' UNION SELECT * FROM users --",
        "'; EXEC xp_cmdshell('dir'); --",
      ];

      for (const injection of injectionAttempts) {
        const res = await request(app)
          .post('/api/wishes')
          .send({
            content: 'SQL injection attempt',
            card_style: { paperColor: injection, pinColor: 'ruby' },
          });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid card_style paperColor');
      }

      // Verify table still exists and is healthy
      const count = await db.prepare('SELECT COUNT(*) as count FROM wishes').get();
      expect(count).toBeDefined();
    });

    it('rejects XSS and HTML tags in card_style color fields with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .send({
          content: 'XSS attempt',
          card_style: { paperColor: '<script>alert(1)</script>' },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });

    it('rejects oversized string payloads in card_style with HTTP 400', async () => {
      const oversized = 'a'.repeat(50000);
      const res = await request(app)
        .post('/api/wishes')
        .send({
          content: 'Oversized color name',
          card_style: { paperColor: oversized },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style paperColor');
    });
  });

  // ── Dimension 5: Multipart / Form-Data Edge Cases ───────────────────────
  describe('Multipart/Form-Data Edge Cases with File Upload', () => {
    const dummyImageBuffer = Buffer.from('fake-image-bytes-for-test');

    it('successfully processes multipart upload with valid JSON card_style', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with image and card style')
        .field('card_style', JSON.stringify({ paperColor: 'rose', pinColor: 'violet' }))
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(201);
      const getRes = await request(app).get(`/api/wishes/${res.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.card_style).toEqual({ paperColor: 'rose', pinColor: 'violet' });
      expect(getRes.body.image_id).toBeDefined();
    });

    it('successfully defaults card_style when omitted in multipart upload', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart without card style')
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(201);
      const getRes = await request(app).get(`/api/wishes/${res.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.card_style).toEqual({ paperColor: 'ivory', pinColor: 'ruby' });
    });

    it('successfully defaults card_style when empty string in multipart upload', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with empty string card style')
        .field('card_style', '')
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(201);
      const getRes = await request(app).get(`/api/wishes/${res.body.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.card_style).toEqual({ paperColor: 'ivory', pinColor: 'ruby' });
    });

    it('rejects multipart upload with non-JSON string card_style with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with bad card style')
        .field('card_style', 'not-a-json-object')
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid card_style payload');
    });

    it('rejects multipart upload with stringified array with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with array card style')
        .field('card_style', JSON.stringify(['ivory', 'ruby']))
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects multipart upload with stringified number with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with number card style')
        .field('card_style', '12345')
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects multipart upload with multiple card_style fields with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with duplicate card_style')
        .field('card_style', JSON.stringify({ paperColor: 'rose', pinColor: 'ruby' }))
        .field('card_style', JSON.stringify({ paperColor: 'canary', pinColor: 'amber' }))
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects multipart upload with "null" string card_style with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/wishes')
        .field('content', 'Multipart with null string')
        .field('card_style', 'null')
        .attach('image', dummyImageBuffer, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // ── Dimension 6: Database Migration & Pre-existing Table Resilience ──────
  describe('Database Migration & Idempotency Resilience', () => {
    it('handles idempotent column addition and corrupt DB row fallback', async () => {
      // 1. Verify parseCardStyle resilience on corrupt values
      expect(parseCardStyle(null)).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle(undefined)).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('not-json')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('12345')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('[]')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('{}')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('{"paperColor":"nonexistent"}')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('{"pinColor":"nonexistent"}')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle('{"paperColor":123,"pinColor":null}')).toEqual(DEFAULT_CARD_STYLE);
      expect(parseCardStyle({ paperColor: 'rose', pinColor: 'nonexistent' })).toEqual({
        paperColor: 'rose',
        pinColor: 'ruby',
      });
      expect(parseCardStyle({ paperColor: 'unknown', pinColor: 'sapphire' })).toEqual({
        paperColor: 'ivory',
        pinColor: 'sapphire',
      });

      // 2. Insert corrupted rows directly into DB and test ALL retrieval endpoints
      const now = new Date().toISOString();
      await db
        .prepare(
          'INSERT INTO wishes (id, content, created_at, updated_at, is_active, card_style) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('corrupt_1', 'Corrupt row 1', now, now, 1, 'not-valid-json');

      await db
        .prepare(
          'INSERT INTO wishes (id, content, created_at, updated_at, is_active, card_style) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(
          'corrupt_2',
          'Corrupt row 2',
          now,
          now,
          1,
          '{"paperColor":"invalid","pinColor":"invalid"}'
        );

      await db
        .prepare(
          'INSERT INTO wishes (id, content, created_at, updated_at, is_active, card_style) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('corrupt_3', 'Corrupt row 3', now, now, 1, '12345');

      // GET /api/wishes/:id
      const get1 = await request(app).get('/api/wishes/corrupt_1');
      expect(get1.status).toBe(200);
      expect(get1.body.card_style).toEqual(DEFAULT_CARD_STYLE);

      const get2 = await request(app).get('/api/wishes/corrupt_2');
      expect(get2.status).toBe(200);
      expect(get2.body.card_style).toEqual(DEFAULT_CARD_STYLE);

      const get3 = await request(app).get('/api/wishes/corrupt_3');
      expect(get3.status).toBe(200);
      expect(get3.body.card_style).toEqual(DEFAULT_CARD_STYLE);

      // GET /api/wishes
      const listRes = await request(app).get('/api/wishes');
      expect(listRes.status).toBe(200);
      for (const wish of listRes.body) {
        expect(wish.card_style).toEqual(DEFAULT_CARD_STYLE);
      }

      // GET /api/wishes/random
      const randomRes = await request(app).get('/api/wishes/random?limit=10');
      expect(randomRes.status).toBe(200);
      for (const wish of randomRes.body) {
        expect(wish.card_style).toEqual(DEFAULT_CARD_STYLE);
      }
    });

    it('handles corrupt card_style safely in user wishes and wish reactivation', async () => {
      // Register a user
      const reg = await request(app)
        .post('/api/users/register')
        .send({ username: 'corrupt_test_user', passphrase: 'user-pass-123' });
      expect(reg.status).toBe(200);
      const token = reg.body.token;
      const userId = reg.body.id;

      // Insert inactive wish with corrupt card_style for this user
      const now = new Date().toISOString();
      await db
        .prepare(
          'INSERT INTO wishes (id, user_id, content, created_at, updated_at, is_active, card_style) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run('user_corrupt_1', userId, 'User corrupt wish', now, now, 0, 'corrupt-card-style');

      // GET /api/users/me/wishes
      const userWishes = await request(app)
        .get('/api/users/me/wishes')
        .set('Authorization', `Bearer ${token}`);
      expect(userWishes.status).toBe(200);
      expect(userWishes.body[0].card_style).toEqual(DEFAULT_CARD_STYLE);

      // POST /api/wishes/:id/reactivate
      const reactivate = await request(app)
        .post('/api/wishes/user_corrupt_1/reactivate')
        .set('Authorization', `Bearer ${token}`);
      expect(reactivate.status).toBe(200);
      expect(reactivate.body.success).toBe(true);

      // Verify reactivated wish in /api/wishes
      const wishRes = await request(app).get('/api/wishes/user_corrupt_1');
      expect(wishRes.status).toBe(200);
      expect(wishRes.body.card_style).toEqual(DEFAULT_CARD_STYLE);
      expect(Boolean(wishRes.body.is_active)).toBe(true);
    });

    it('demonstrates idempotent table alteration and backward-compatible data migration', async () => {
      // 1. Create a legacy table without card_style
      await db.execute(`
        CREATE TABLE IF NOT EXISTS legacy_wishes (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL
        )
      `);
      await db.execute(
        "INSERT INTO legacy_wishes (id, content) VALUES ('leg_1', 'Legacy content')"
      );

      // 2. Migration function mimicking db.js ensureColumn
      const ensureCol = async (table, column, type) => {
        const rs = await db.execute(`PRAGMA table_info(${table})`);
        const hasColumn = rs.rows.some((info) => info.name === column);
        if (!hasColumn) {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        }
      };

      // 3. First run: adds card_style
      await ensureCol('legacy_wishes', 'card_style', 'TEXT');

      // Check column exists
      const infoAfter1 = await db.execute('PRAGMA table_info(legacy_wishes)');
      expect(infoAfter1.rows.some((c) => c.name === 'card_style')).toBe(true);

      // Verify existing row has null card_style and parses safely
      const legacyRow = await db
        .prepare('SELECT id, content, card_style FROM legacy_wishes WHERE id = ?')
        .get('leg_1');
      expect(legacyRow.card_style).toBeNull();
      expect(parseCardStyle(legacyRow.card_style)).toEqual(DEFAULT_CARD_STYLE);

      // 4. Second run: idempotently does not throw or fail
      await expect(ensureCol('legacy_wishes', 'card_style', 'TEXT')).resolves.not.toThrow();

      // 5. Insert new row with card_style
      const stylePayload = JSON.stringify({ paperColor: 'sage', pinColor: 'emerald' });
      await db
        .prepare('INSERT INTO legacy_wishes (id, content, card_style) VALUES (?, ?, ?)')
        .run('leg_2', 'New row', stylePayload);

      const newRow = await db
        .prepare('SELECT id, content, card_style FROM legacy_wishes WHERE id = ?')
        .get('leg_2');
      expect(parseCardStyle(newRow.card_style)).toEqual({
        paperColor: 'sage',
        pinColor: 'emerald',
      });

      // Clean up legacy table
      await db.execute('DROP TABLE IF EXISTS legacy_wishes');
    });
  });

  // ── Dimension 7: Concurrency & Stress Testing ────────────────────────────
  describe('High-Concurrency Stress Testing', () => {
    it('handles 50 simultaneous wish submissions with alternating card styles cleanly', async () => {
      const styles = [
        { paperColor: 'ivory', pinColor: 'ruby' },
        { paperColor: 'canary', pinColor: 'amber' },
        { paperColor: 'rose', pinColor: 'emerald' },
        { paperColor: 'sky', pinColor: 'sapphire' },
        { paperColor: 'sage', pinColor: 'violet' },
      ];

      const totalRequests = 50;
      const submissions = Array.from({ length: totalRequests }, (_, i) => {
        const expectedStyle = styles[i % styles.length];
        return {
          index: i,
          content: `Concurrent wish #${i}`,
          style: expectedStyle,
        };
      });

      // Submit all concurrently
      const results = await Promise.all(
        submissions.map((sub) =>
          request(app).post('/api/wishes').send({ content: sub.content, card_style: sub.style })
        )
      );

      // Verify all 50 succeeded with 201
      for (const res of results) {
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
      }

      // Collect IDs
      const createdIds = results.map((r) => r.body.id);
      // Ensure all 50 IDs are distinct
      const uniqueIds = new Set(createdIds);
      expect(uniqueIds.size).toBe(totalRequests);

      // Verify each wish retained its exact card_style without race conditions or cross-talk
      const getChecks = await Promise.all(
        createdIds.map((id) => request(app).get(`/api/wishes/${id}`))
      );

      for (let i = 0; i < totalRequests; i++) {
        const getRes = getChecks[i];
        expect(getRes.status).toBe(200);
        expect(getRes.body.card_style).toEqual(submissions[i].style);
        expect(getRes.body.content).toBe(`Concurrent wish #${i}`);
      }
    });
  });
});
