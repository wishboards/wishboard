/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const db = (await import('../db.js')).default;
const { parseCardStyle, CARD_PAPER_COLORS, CARD_PIN_COLORS, DEFAULT_CARD_STYLE } = await import(
  './wishes.js'
);
const app = appModule.default;

const imagesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/images'
);
const createdImageIds = [];

afterEach(async () => {
  await db.exec('DELETE FROM wish_exclusions');
  await db.exec('DELETE FROM wishes');
  await db.exec('DELETE FROM sessions');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
  await db.exec('DELETE FROM rules');
  for (const id of createdImageIds.splice(0)) {
    try {
      fs.unlinkSync(path.join(imagesDir, id));
    } catch {
      // already gone
    }
  }
});

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

describe('parseCardStyle', () => {
  it('returns the defaults for missing, empty, and unparseable input', () => {
    for (const raw of [null, undefined, '', 'not json', 42]) {
      expect(parseCardStyle(raw)).toEqual({ paperColor: 'ivory', pinColor: 'ruby' });
    }
  });

  it('keeps valid colors from JSON strings and objects, per field independently', () => {
    expect(parseCardStyle('{"paperColor":"sky","pinColor":"violet"}')).toEqual({
      paperColor: 'sky',
      pinColor: 'violet',
    });
    expect(parseCardStyle({ paperColor: 'bogus', pinColor: 'amber' })).toEqual({
      paperColor: 'ivory',
      pinColor: 'amber',
    });
    expect(parseCardStyle({ paperColor: 'sage', pinColor: 'bogus' })).toEqual({
      paperColor: 'sage',
      pinColor: 'ruby',
    });
    expect(parseCardStyle('{}')).toEqual({ paperColor: 'ivory', pinColor: 'ruby' });
  });

  it('accepts every declared color and returns a fresh object each time', () => {
    for (const c of CARD_PAPER_COLORS) {
      expect(parseCardStyle({ paperColor: c }).paperColor).toBe(c);
    }
    for (const c of CARD_PIN_COLORS) {
      expect(parseCardStyle({ pinColor: c }).pinColor).toBe(c);
    }
    const out = parseCardStyle(null);
    out.paperColor = 'canary';
    expect(DEFAULT_CARD_STYLE.paperColor).toBe('ivory');
    expect(Object.isFrozen(DEFAULT_CARD_STYLE)).toBe(true);
  });
});

describe('POST /api/wishes: exact persistence', () => {
  it('anonymous create trims content, trims the passphrase into the secret, and stores salt:hash', async () => {
    const res = await request(app)
      .post('/api/wishes')
      .send({ content: '  A padded wish  ', passphrase: '  my pass  ' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'secret']);
    expect(res.body.secret).toBe('my pass');
    const row = await db
      .prepare('SELECT user_id, content, secret_hash, contacts, wishmail_enabled FROM wishes WHERE id = ?')
      .get(res.body.id);
    expect(row.user_id).toBeNull();
    expect(row.content).toBe('A padded wish');
    expect(row.secret_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(row.contacts).toBe('[]');
    expect(row.wishmail_enabled).toBe(0);
  });

  it('anonymous create without a passphrase generates a secret and still stores a hash', async () => {
    const res = await request(app).post('/api/wishes').send({ content: 'No passphrase wish' });
    expect(res.status).toBe(201);
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.secret.length).toBeGreaterThan(0);
    const row = await db.prepare('SELECT secret_hash FROM wishes WHERE id = ?').get(res.body.id);
    expect(row.secret_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('logged-in create stores no secret and merges profile attributes under the wish ones', async () => {
    const reg = await request(app)
      .post('/api/users/register')
      .send({
        username: 'wish_merger',
        passphrase: 'pw',
        identity_attributes: { gender: ['woman'], orientation: ['queer'] },
      });
    const token = reg.body.token;
    const res = await request(app)
      .post('/api/wishes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        content: 'Merged attrs wish',
        creator_attributes: { gender: ['man'], role: ['top'] },
        card_style: { paperColor: 'canary', pinColor: 'amber' },
      });
    expect(res.status).toBe(201);
    expect(res.body.secret).toBeNull();
    const row = await db
      .prepare('SELECT user_id, secret_hash, creator_attributes, card_style FROM wishes WHERE id = ?')
      .get(res.body.id);
    expect(row.user_id).toBe(reg.body.id);
    expect(row.secret_hash).toBeNull();
    expect(JSON.parse(row.creator_attributes)).toEqual({
      gender: ['man'],
      orientation: ['queer'],
      role: ['top'],
    });
    expect(row.card_style).toBe('{"paperColor":"canary","pinColor":"amber"}');
  });

  it('rejects conflicting creator and desired attributes with the exact messages', async () => {
    const adminLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'admin', passphrase: 'admin-board' });
    const ruleRes = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({
        rule_type: 'exclusion',
        trigger_attribute: 'orientation',
        target_attribute: 'orientation',
        trigger_value: 'gay',
        target_value: 'straight',
      });
    expect(ruleRes.status).toBe(200);

    const creator = await request(app)
      .post('/api/wishes')
      .send({ content: 'Conflict wish', creator_attributes: { orientation: ['gay', 'straight'] } });
    expect(creator.status).toBe(400);
    expect(creator.body).toEqual({
      error: 'Validation failed: Creator attributes conflict. "gay" and "straight" are mutually exclusive.',
    });

    const desired = await request(app)
      .post('/api/wishes')
      .send({ content: 'Conflict wish 2', desired_attributes: { orientation: ['gay', 'straight'] } });
    expect(desired.status).toBe(400);
    expect(desired.body).toEqual({
      error: 'Validation failed: Desired criteria conflict. "gay" and "straight" are mutually exclusive.',
    });
  });
});

describe('POST /api/wishes: image upload rules', () => {
  const upload = (buffer, filename) =>
    request(app).post('/api/wishes').attach('image', buffer, filename).field('content', 'Upload wish');

  it.each(['.png', '.jpg', '.jpeg', '.webp'])('accepts a %s upload', async (ext) => {
    const res = await upload(PNG_1PX, `photo${ext}`);
    expect(res.status).toBe(201);
    const row = await db.prepare('SELECT image_id FROM wishes WHERE id = ?').get(res.body.id);
    expect(row.image_id).toMatch(new RegExp(`^image-\\d+-\\d+\\${ext}$`));
    createdImageIds.push(row.image_id);
  });

  it('lowercases an uppercase extension; a missing extension is rejected by the filter', async () => {
    const upper = await upload(PNG_1PX, 'PHOTO.JPG');
    expect(upper.status).toBe(201);
    const row = await db.prepare('SELECT image_id FROM wishes WHERE id = ?').get(upper.body.id);
    expect(row.image_id).toMatch(/\.jpg$/);
    createdImageIds.push(row.image_id);

    // The filter runs before the filename generator, so the generator's '.png'
    // fallback never sees an extensionless file: it is a 400 like any bad type.
    const noExt = await upload(PNG_1PX, 'photo');
    expect(noExt.status).toBe(400);
    expect(noExt.body).toEqual({
      error: 'Invalid file type. Only PNG, JPG, and WEBP are allowed.',
    });
  });

  it('rejects a .gif with the exact 400 error and creates no wish', async () => {
    const res = await upload(Buffer.from('GIF89a'), 'anim.gif');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Invalid file type. Only PNG, JPG, and WEBP are allowed.',
    });
    const count = await db.prepare('SELECT COUNT(*) AS c FROM wishes').get();
    expect(count.c).toBe(0);
  });

  it('accepts a 100KB image but rejects one over the 5MB limit', async () => {
    const hundredKb = Buffer.alloc(100 * 1024, 1);
    const ok = await upload(hundredKb, 'big.png');
    expect(ok.status).toBe(201);
    const row = await db.prepare('SELECT image_id FROM wishes WHERE id = ?').get(ok.body.id);
    createdImageIds.push(row.image_id);

    const overLimit = Buffer.alloc(5 * 1024 * 1024 + 1024, 1);
    const res = await upload(overLimit, 'huge.png');
    expect(res.status).not.toBe(201);
    const count = await db.prepare('SELECT COUNT(*) AS c FROM wishes').get();
    expect(count.c).toBe(1);
  });
});

describe('GET /api/wishes: search parameter semantics', () => {
  const seedPair = async () => {
    const a = await request(app)
      .post('/api/wishes')
      .send({
        content: 'Lesbian wish',
        creator_attributes: { gender: ['woman'], orientation: ['lesbian'] },
        desired_attributes: { gender: ['woman'] },
      });
    const b = await request(app)
      .post('/api/wishes')
      .send({
        content: 'Straight Woman wish',
        creator_attributes: { gender: ['woman'], orientation: ['straight'] },
        desired_attributes: { gender: ['man'] },
      });
    return { a: a.body.id, b: b.body.id };
  };
  const contents = (res) => res.body.map((w) => w.content);

  it('trims the q parameter before matching', async () => {
    await seedPair();
    const res = await request(app).get('/api/wishes').query({ q: '  Lesbian  ' });
    expect(contents(res)).toEqual(['Lesbian wish']);
  });

  it('anonymous search with no attributes returns everything (auto-ignore)', async () => {
    await seedPair();
    const res = await request(app).get('/api/wishes').query({ q: 'wish' });
    expect(contents(res).sort()).toEqual(['Lesbian wish', 'Straight Woman wish']);
  });

  it("ignore_attributes accepts '1' and 'true' but not other values", async () => {
    await seedPair();
    const base = { sg: 'man', so: 'straight', q: 'wish' };
    const filtered = await request(app).get('/api/wishes').query(base);
    expect(contents(filtered)).toEqual(['Straight Woman wish']);
    for (const val of ['1', 'true']) {
      const res = await request(app)
        .get('/api/wishes')
        .query({ ...base, ignore_attributes: val });
      expect(contents(res).sort()).toEqual(['Lesbian wish', 'Straight Woman wish']);
    }
    const notIgnored = await request(app)
      .get('/api/wishes')
      .query({ ...base, ignore_attributes: 'yes' });
    expect(contents(notIgnored)).toEqual(['Straight Woman wish']);
  });

  it('the attributes JSON wins over the sg alias for the same category', async () => {
    await seedPair();
    const res = await request(app)
      .get('/api/wishes')
      .query({
        q: 'wish',
        sg: 'man',
        so: 'lesbian',
        attributes: JSON.stringify({ gender: ['woman'] }),
      });
    // Searcher identity: gender from the JSON (woman), orientation from the
    // alias (lesbian) — the lesbian-woman searcher matches the Lesbian wish.
    // If the alias gender (man) had won, that wish's desired gender (woman)
    // would have rejected the searcher.
    expect(contents(res)).toEqual(['Lesbian wish']);
  });

  it('exclude trims ids and drops empties; ids returns exactly the listed wishes', async () => {
    const { a, b } = await seedPair();
    const excluded = await request(app)
      .get('/api/wishes')
      .query({ q: 'wish', exclude: ` ${a} , ,` });
    expect(contents(excluded)).toEqual(['Straight Woman wish']);
    const only = await request(app).get('/api/wishes').query({ ids: ` ${b} ` });
    expect(contents(only)).toEqual(['Straight Woman wish']);
    const both = await request(app).get('/api/wishes').query({ ids: `${a},${b}` });
    expect(contents(both).sort()).toEqual(['Lesbian wish', 'Straight Woman wish']);
  });

  it('a signed-in user\'s exclusions hide wishes unless include_excluded is set', async () => {
    const { a, b } = await seedPair();
    const reg = await request(app)
      .post('/api/users/register')
      .send({ username: 'search_excluder', passphrase: 'pw' });
    const token = reg.body.token;
    const headers = { Authorization: `Bearer ${token}` };
    const hide = await request(app).post(`/api/wishes/${a}/exclude`).set(headers);
    expect(hide.status).toBe(200);
    // ignore_attributes isolates the exclusion behavior from profile matching
    // (this searcher has no identity attributes).
    const hidden = await request(app)
      .get('/api/wishes')
      .query({ q: 'wish', ignore_attributes: '1' })
      .set(headers);
    expect(contents(hidden)).toEqual(['Straight Woman wish']);
    const shown = await request(app)
      .get('/api/wishes')
      .query({ q: 'wish', ignore_attributes: '1', include_excluded: '1' })
      .set(headers);
    expect(contents(shown).sort()).toEqual(['Lesbian wish', 'Straight Woman wish']);
    // The query-string exclude parameter does not apply to signed-in searchers:
    // excluding the OTHER wish by query string changes nothing.
    const other = await request(app)
      .get('/api/wishes')
      .query({ q: 'wish', ignore_attributes: '1', exclude: b })
      .set(headers);
    expect(contents(other)).toEqual(['Straight Woman wish']);
  });
});

describe('GET /api/wishes/random: exact row shape', () => {
  it('maps rows exactly, applies card-style defaults, and honors limit', async () => {
    for (const content of ['Random one', 'Random two', 'Random three']) {
      await request(app).post('/api/wishes').send({ content });
    }
    const res = await request(app).get('/api/wishes/random').query({ limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const row of res.body) {
      expect(Object.keys(row).sort()).toEqual([
        'card_style',
        'contacts',
        'content',
        'creator_attributes',
        'id',
        'image_id',
        'wishmail_enabled',
      ]);
      expect(row.card_style).toEqual({ paperColor: 'ivory', pinColor: 'ruby' });
      expect(row.contacts).toEqual([]);
      expect(row.wishmail_enabled).toBe(false);
      expect(row.image_id).toBeNull();
    }
    const all = await request(app).get('/api/wishes/random');
    expect(all.body).toHaveLength(3);
  });
});
