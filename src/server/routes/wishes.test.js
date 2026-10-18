/** @vitest-environment node */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Write the test rules copy to a throwaway temp dir (reaped in afterAll) rather
// than into the repo's data/ directory.
const tmpRulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-wishes-'));
const rulesPath = path.join(tmpRulesDir, 'rules.test.yaml');

process.env.WISHBOARD_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.RULES_PATH = rulesPath;

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const app = appModule.default;
const db = (await import('../db.js')).default;
const { addRule, reloadRules, stopWatchingRules } = await import('../rulesManager.js');
const {
  normalizeToken,
  escapeRegExp,
  hasToken,
  parseJsonSafe,
  parseAttributesInput,
  getExclusionConflicts,
} = await import('./wishes.js');
const { createRule } = await import('../../../tests/testUtils.ts');

const clearTestData = async () => {
  await db.exec('DELETE FROM sessions');
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

describe('Authenticated wish creation', () => {
  it('applies logged-in user identity attributes to created wishes', async () => {
    const register = await request(app)
      .post('/api/users/register')
      .send({
        username: 'user3',
        passphrase: 'secret',
        identity_attributes: { gender: ['woman'], orientation: ['queer'], role: ['speaker'] },
      })
      .set('Accept', 'application/json');

    expect(register.status).toBe(200);
    const login = await request(app)
      .post('/api/users/login')
      .send({ username: 'user3', passphrase: 'secret' })
      .set('Accept', 'application/json');

    expect(login.status).toBe(200);
    const token = login.body.token;
    expect(token).toBeTypeOf('string');

    const wishResponse = await request(app)
      .post('/api/wishes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Help me' })
      .set('Accept', 'application/json');

    expect(wishResponse.status).toBe(201);
    expect(wishResponse.body.id).toBeTypeOf('string');

    const dbRow = await db
      .prepare('SELECT creator_attributes FROM wishes WHERE id = ?')
      .get(wishResponse.body.id);
    const creatorAttrs = JSON.parse(dbRow.creator_attributes);
    expect(creatorAttrs.gender).toEqual(['woman']);
    expect(creatorAttrs.orientation).toEqual(['queer']);
    expect(creatorAttrs.role).toEqual(['speaker']);
  });

  it('saves contacts and wishmail_enabled flag', async () => {
    const wishResponse = await request(app)
      .post('/api/wishes')
      .send({
        content: 'Contact test',
        contacts: [{ type: 'Email', value: 'test@example.com' }],
        wishmail_enabled: true,
      })
      .set('Accept', 'application/json');

    expect(wishResponse.status).toBe(201);

    const row = await db
      .prepare('SELECT contacts, wishmail_enabled FROM wishes WHERE id = ?')
      .get(wishResponse.body.id);
    expect(JSON.parse(row.contacts)).toEqual([{ type: 'Email', value: 'test@example.com' }]);
    expect(row.wishmail_enabled).toBe(1);
  });

  it('accepts multipart form data with image and returns image_id', async () => {
    // Create a 1x1 transparent PNG buffer
    const dummyImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );

    const wishResponse = await request(app)
      .post('/api/wishes')
      .attach('image', dummyImage, 'test.png')
      .field('content', 'This is my handwritten wish')
      .field('wishmail_enabled', 'true')
      .set('Accept', 'application/json');

    expect(wishResponse.status).toBe(201);
    expect(wishResponse.body.id).toBeTypeOf('string');

    const row = await db
      .prepare('SELECT content, wishmail_enabled, image_id FROM wishes WHERE id = ?')
      .get(wishResponse.body.id);
    expect(row.content).toBe('This is my handwritten wish');
    expect(row.wishmail_enabled).toBe(1);
    expect(row.image_id).toBeTypeOf('string');
    expect(row.image_id).toMatch(/image-.*\.png/);
  });

  it('rejects uploads of invalid file types', async () => {
    const dummyText = Buffer.from('this is not an image');
    const wishResponse = await request(app)
      .post('/api/wishes')
      .attach('image', dummyText, 'test.txt')
      .field('content', 'This should fail')
      .set('Accept', 'application/json');

    expect(wishResponse.status).toBe(400);
    expect(wishResponse.text).toMatch(/Invalid file type/);
  });
});

describe('Matchmaking logic', () => {
  it('correctly filters mutually compatible and incompatible wishes based on gender and orientation', async () => {
    // 1. Create Lesbian Woman wish
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Lesbian wish',
        creator_attributes: { gender: ['woman'], orientation: ['lesbian'] },
        desired_attributes: { gender: ['woman'] },
      });

    // 2. Create Straight Woman wish
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Straight Woman wish',
        creator_attributes: { gender: ['woman'], orientation: ['straight'] },
        desired_attributes: { gender: ['man'] },
      });

    // 3. Search as a Straight Man
    const resSearch1 = await request(app).get('/api/wishes').query({
      sg: 'man',
      so: 'straight',
      q: 'wish',
    });

    // Straight man should see "Straight Woman wish" but NOT "Lesbian wish".
    const contents1 = resSearch1.body.map((w) => w.content);
    console.log(resSearch1.body);
    expect(contents1).toContain('Straight Woman wish');
    expect(contents1).not.toContain('Lesbian wish');

    // 4. Search as a Lesbian Woman
    const resSearch2 = await request(app).get('/api/wishes').query({
      sg: 'woman',
      so: 'lesbian',
      q: 'wish',
    });

    // Lesbian woman should see "Lesbian wish" but NOT "Straight Woman wish".
    const contents2 = resSearch2.body.map((w) => w.content);
    expect(contents2).toContain('Lesbian wish');
    expect(contents2).not.toContain('Straight Woman wish');
  });

  it('correctly matches role preferences (dom/sub)', async () => {
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Sub looking for dom',
        creator_attributes: { role: ['sub'] },
        desired_attributes: { role: ['dom'] },
      });

    const resSearchDom = await request(app).get('/api/wishes').query({
      sr: 'dom',
      q: 'Sub',
    });
    expect(resSearchDom.body.map((w) => w.content)).toContain('Sub looking for dom');

    const resSearchSub = await request(app).get('/api/wishes').query({
      sr: 'sub',
      q: 'Sub',
    });
    expect(resSearchSub.body.map((w) => w.content)).not.toContain('Sub looking for dom');
  });

  it('correctly uses implicit preferences when desired_genders is empty', async () => {
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Implicit Lesbian wish',
        creator_attributes: { gender: ['woman'], orientation: ['lesbian'] },
      });

    const resSearch1 = await request(app).get('/api/wishes').query({
      sg: 'man',
      so: 'straight',
      q: 'Implicit Lesbian wish',
    });

    expect(resSearch1.body).toHaveLength(0);
  });

  it('prevents straight users from matching their own gender implicitly', async () => {
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Straight Man wish',
        creator_attributes: { gender: ['man'], orientation: ['straight'] },
      });

    const resSearch1 = await request(app).get('/api/wishes').query({
      sg: 'man',
      so: 'straight',
      q: 'Straight Man wish',
    });

    expect(resSearch1.body).toHaveLength(0);
  });

  it('allows explicit desired_genders to override implicit orientation preferences', async () => {
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Lesbian looking for man',
        creator_attributes: { gender: ['woman'], orientation: ['lesbian'] },
        desired_attributes: { gender: ['man'] },
      });

    const resSearch1 = await request(app).get('/api/wishes').query({
      sg: 'man',
      so: 'straight',
      q: 'Lesbian looking for man',
    });

    expect(resSearch1.body).toHaveLength(1);
  });

  it('does not match when neither orientation nor a desired gender is specified (#199)', async () => {
    // Previously an unspecified orientation meant "accepts all genders", which
    // over-matched — a woman's wish with no stated orientation and no desired
    // gender was shown to a straight man. With no basis to infer a preference,
    // it must not match; the user should set an orientation or a desired gender.
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'No orientation wish',
        creator_attributes: { gender: ['woman'], orientation: [''] },
      });

    const resSearch1 = await request(app).get('/api/wishes').query({
      sg: 'man',
      so: 'straight',
      q: 'No orientation wish',
    });

    expect(resSearch1.body).toHaveLength(0);
  });

  it('still matches a no-orientation wish when the searcher fits an explicit desired gender', async () => {
    // Tightening the implicit path must not harm wishes that DO state who they
    // want: no orientation, but an explicit desired gender still matches.
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'No orientation but wants men',
        creator_attributes: { gender: ['woman'], orientation: [''] },
        desired_attributes: { gender: ['man'] },
      });

    const resSearch1 = await request(app).get('/api/wishes').query({
      sg: 'man',
      so: 'straight',
      q: 'No orientation but wants men',
    });

    expect(resSearch1.body).toHaveLength(1);
  });

  it('correctly uses rule engine for expansions and cross-matches (handler/pet/pup)', async () => {
    // 1. Add rules via rulesManager
    addRule(createRule('r1', 'expansion', 'role', 'role', 'pet', 'pup, kitten'));
    addRule(createRule('r2', 'cross_match', 'role', 'role', 'handler', 'pet'));

    // 2. Create wish wanting a pet
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Looking for pet',
        desired_attributes: { role: ['pet'] },
      });

    // 3. Search as pup (expansion match)
    const resPup = await request(app).get('/api/wishes').query({ sr: 'pup', q: 'Looking for pet' });
    expect(resPup.body).toHaveLength(1);

    // 4. Search as handler (cross match)
    const resHandler = await request(app)
      .get('/api/wishes')
      .query({ sr: 'handler', q: 'Looking for pet' });
    expect(resHandler.body).toHaveLength(1);

    // 5. Create wish wanting a handler
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Looking for handler',
        desired_attributes: { role: ['handler'] },
      });

    // 6. Search as pet (cross match)
    const resPet = await request(app)
      .get('/api/wishes')
      .query({ sr: 'pet', q: 'Looking for handler' });
    expect(resPet.body).toHaveLength(1);

    // 7. Search as pup (expansion of cross match!)
    const resPupCross = await request(app)
      .get('/api/wishes')
      .query({ sr: 'pup', q: 'Looking for handler' });
    expect(resPupCross.body).toHaveLength(1);

    // Cleanup rules
    // Rules are handled by the afterEach hook
  });
});

describe('Claiming wishes', () => {
  it('allows an authenticated user to claim an anonymous wish with the correct passphrase', async () => {
    // 1. Create anonymous wish
    const wishRes = await request(app).post('/api/wishes').send({ content: 'Anonymous wish' });
    expect(wishRes.status).toBe(201);
    const wishId = wishRes.body.id;
    const secret = wishRes.body.secret;

    // 2. Create and login user
    await request(app)
      .post('/api/users/register')
      .send({ username: 'claimuser', passphrase: 'pwd' });
    const loginRes = await request(app)
      .post('/api/users/login')
      .send({ username: 'claimuser', passphrase: 'pwd' });
    const token = loginRes.body.token;

    // 3. Claim the wish
    const claimRes = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret });

    expect(claimRes.status).toBe(200);
    expect(claimRes.body.success).toBe(true);

    // 4. Verify wish is now owned by the user
    const userWishesRes = await request(app)
      .get('/api/users/me/wishes')
      .set('Authorization', `Bearer ${token}`);
    expect(userWishesRes.body).toHaveLength(1);
    expect(userWishesRes.body[0].id).toBe(wishId);
  });

  it('allows managing wish with contacts and wishmail_enabled', async () => {
    const wishRes = await request(app).post('/api/wishes').send({ content: 'Manage test' });
    const { id, secret } = wishRes.body;

    const manageRes = await request(app)
      .post(`/api/wishes/${id}/manage`)
      .send({
        secret,
        content: 'Updated content',
        contacts: [{ type: 'Phone', value: '123' }],
        wishmail_enabled: true,
        action: 'update',
      });

    expect(manageRes.status).toBe(200);

    const viewRes = await request(app).get(`/api/wishes/${id}`);
    expect(viewRes.body.content).toBe('Updated content');
    expect(viewRes.body.contacts).toEqual([{ type: 'Phone', value: '123' }]);
    expect(viewRes.body.wishmail_enabled).toBe(true);
  });

  it('prevents claiming with wrong passphrase or without auth', async () => {
    const wishRes = await request(app).post('/api/wishes').send({ content: 'Anon' });
    const wishId = wishRes.body.id;

    // Unauthenticated
    const noAuth = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .send({ secret: wishRes.body.secret });
    expect(noAuth.status).toBe(401);

    // Wrong passphrase
    await request(app).post('/api/users/register').send({ username: 'u2', passphrase: 'p' });
    const loginRes = await request(app)
      .post('/api/users/login')
      .send({ username: 'u2', passphrase: 'p' });
    const token = loginRes.body.token;

    const wrongPass = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: 'wrong' });
    expect(wrongPass.status).toBe(403);
  });

  it('correctly matches gender synonyms and variants using rules engine', async () => {
    // 1. Wish desiring 'nonbinary', searcher is 'enby' (should match)
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Wish for nonbinary',
        creator_attributes: { gender: ['woman'], orientation: ['pan'] },
        desired_attributes: { gender: ['nonbinary'] },
      });
    const resEnby = await request(app).get('/api/wishes').query({
      sg: 'enby',
      so: 'pan',
      q: 'Wish for nonbinary',
    });
    expect(resEnby.body.length).toBe(1);

    // 2. Wish desiring 'woman', searcher is 'female' (should match)
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Wish for woman',
        creator_attributes: { gender: ['man'], orientation: ['straight'] },
        desired_attributes: { gender: ['woman'] },
      });
    const resFemale = await request(app).get('/api/wishes').query({
      sg: 'female',
      so: 'straight',
      q: 'Wish for woman',
    });
    expect(resFemale.body.length).toBe(1);

    // 3. Wish desiring 'man', searcher is 'male' (should match)
    await request(app)
      .post('/api/wishes')
      .send({
        content: 'Wish for man',
        creator_attributes: { gender: ['woman'], orientation: ['straight'] },
        desired_attributes: { gender: ['man'] },
      });
    const resMale = await request(app).get('/api/wishes').query({
      sg: 'male',
      so: 'straight',
      q: 'Wish for man',
    });
    expect(resMale.body.length).toBe(1);
  });
});

describe('wishes route helper functions & file filter', () => {
  it('normalizeToken trims, lowercases, and handles nullish input', () => {
    expect(normalizeToken('  Hello WORLD  ')).toBe('hello world');
    expect(normalizeToken('')).toBe('');
    expect(normalizeToken(null)).toBe('');
    expect(normalizeToken(undefined)).toBe('');
  });

  it('escapeRegExp correctly escapes special regex characters', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe(String.raw`\.\*\+\?\^\$\{\}\(\)\|\[\]\\`);
    expect(escapeRegExp('normalText')).toBe('normalText');
  });

  it('hasToken performs word boundary matching', () => {
    expect(hasToken('Hello world of coding', 'world')).toBe(true);
    expect(hasToken('Hello world of coding', 'WORLD')).toBe(true);
    expect(hasToken('Hello worldof coding', 'world')).toBe(false);
    expect(hasToken('', 'test')).toBe(false);
  });

  it('parseJsonSafe parses valid JSON and handles invalid/non-string inputs', () => {
    expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonSafe('')).toEqual({});
    expect(parseJsonSafe(null)).toEqual({});
    expect(parseJsonSafe(123)).toBe(123);
    expect(parseJsonSafe('{invalid json}')).toEqual({});
  });

  it('parseAttributesInput normalizes JSON strings, objects, and edge case inputs', () => {
    expect(parseAttributesInput(null)).toEqual({});
    expect(parseAttributesInput('')).toEqual({});
    expect(parseAttributesInput('{"gender": "woman"}')).toEqual({ gender: ['woman'] });
    expect(parseAttributesInput({ gender: 'woman', role: ['speaker'] })).toEqual({
      gender: ['woman'],
      role: ['speaker'],
    });
    expect(parseAttributesInput('["not an object"]')).toEqual({});
    expect(parseAttributesInput(42)).toEqual({});
  });

  it('rejects file uploads with disallowed extensions', async () => {
    const res = await request(app)
      .post('/api/wishes')
      .field('content', 'Wish with invalid image')
      .attach('image', Buffer.from('fake data'), 'malicious.sh');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid file type/i);
  });

  it('getExclusionConflicts identifies conflicting attributes based on rules', () => {
    const rules = [
      createRule(1, 'exclusion', 'orientation', 'orientation', 'gay', 'straight'),
      createRule(2, 'exclusion', 'orientation', 'gender', 'lesbian', 'man', {
        context_attribute: 'gender',
        context_value: 'woman',
      }),
    ];

    // Conflict 1: gay + straight
    const conflicts1 = getExclusionConflicts({ orientation: ['gay', 'straight'] }, rules);
    expect(conflicts1.length).toBe(1);
    expect(conflicts1[0].rule_id).toBe(1);

    // Conflict 2: lesbian woman + man
    const conflicts2 = getExclusionConflicts(
      { orientation: ['lesbian'], gender: ['woman', 'man'] },
      rules
    );
    expect(conflicts2.length).toBe(1);
    expect(conflicts2[0].rule_id).toBe(2);

    // No conflict: lesbian woman without man
    const conflicts3 = getExclusionConflicts(
      { orientation: ['lesbian'], gender: ['woman'] },
      rules
    );
    expect(conflicts3.length).toBe(0);
  });
});

describe('Wish creation, claim, and management API edge cases', () => {
  it('rejects wish creation when neither content nor image is provided', async () => {
    const res = await request(app)
      .post('/api/wishes')
      .send({ content: '   ' })
      .set('Accept', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Wish content is required/i);
  });

  it('handles claim wish API validation and error scenarios', async () => {
    const registerUser = await request(app)
      .post('/api/users/register')
      .send({ username: 'claimer1', passphrase: 'usersecret' });
    const token = registerUser.body.token;

    // Create an anonymous wish with passphrase
    const createRes = await request(app)
      .post('/api/wishes')
      .send({ content: 'Anonymous wish to claim', passphrase: 'claim-wish-passphrase' })
      .set('Accept', 'application/json');

    expect(createRes.status).toBe(201);
    const wishId = createRes.body.id;

    // 1. Claim non-existent wish -> 404
    const notFoundRes = await request(app)
      .post('/api/wishes/nonexistentid/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: 'claim-wish-passphrase' });
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error).toMatch(/Wish not found/i);

    // 2. Claim with missing secret -> 403
    const missingSecretRes = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: '   ' });
    expect(missingSecretRes.status).toBe(403);
    expect(missingSecretRes.body.error).toBe('Invalid passphrase.');

    // 3. Claim with wrong secret -> 403
    const wrongSecretRes = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: 'WrongSecret' });
    expect(wrongSecretRes.status).toBe(403);
    expect(wrongSecretRes.body.error).toBe('Invalid passphrase.');

    // 4. Claim valid wish with correct secret -> 200
    const claimRes = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: 'claim-wish-passphrase' });
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.success).toBe(true);

    // 5. Claim already claimed wish -> 403
    const reClaimRes = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: 'claim-wish-passphrase' });
    expect(reClaimRes.status).toBe(403);
    expect(reClaimRes.body.error).toBe('This wish has already been claimed by a user.');
  });

  it('handles manage wish actions (deactivate, delete, invalid action)', async () => {
    const createRes = await request(app)
      .post('/api/wishes')
      .send({ content: 'Wish to manage', passphrase: 'ManagePassphrase123' });
    const wishId = createRes.body.id;

    // 1. Invalid action -> 400
    const invalidActionRes = await request(app)
      .post(`/api/wishes/${wishId}/manage`)
      .send({ action: 'unknown_action', secret: 'ManagePassphrase123' });
    expect(invalidActionRes.status).toBe(400);
    expect(invalidActionRes.body.error).toBe('Invalid update payload.');

    // 2. Manage non-existent wish -> 404
    const notFoundRes = await request(app)
      .post('/api/wishes/badid/manage')
      .send({ action: 'delete', secret: 'ManagePassphrase123' });
    expect(notFoundRes.status).toBe(404);

    // 3. Manage with wrong passphrase -> 403
    const wrongPassRes = await request(app)
      .post(`/api/wishes/${wishId}/manage`)
      .send({ action: 'delete', secret: 'WrongSecret' });
    expect(wrongPassRes.status).toBe(403);
    expect(wrongPassRes.body.error).toBe('Invalid secret token or unauthorized.');

    // 4. Deactivate wish -> 200
    const deactivateRes = await request(app)
      .post(`/api/wishes/${wishId}/deactivate`)
      .send({ secret: 'ManagePassphrase123' });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.success).toBe(true);

    // 5. Delete wish -> 200
    const deleteRes = await request(app)
      .post(`/api/wishes/${wishId}/manage`)
      .send({ action: 'delete', secret: 'ManagePassphrase123' });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });

  it('supports querying wishes by explicit IDs array with ignore_attributes', async () => {
    const wish1 = await request(app).post('/api/wishes').send({ content: 'Specific wish A' });
    const wish2 = await request(app).post('/api/wishes').send({ content: 'Specific wish B' });

    const queryRes = await request(app)
      .get('/api/wishes')
      .query({ ids: `${wish1.body.id},${wish2.body.id}`, ignore_attributes: '1' });

    expect(queryRes.status).toBe(200);
    expect(queryRes.body.length).toBe(2);
  });
});
