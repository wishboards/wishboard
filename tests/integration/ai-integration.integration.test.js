/** @vitest-environment node */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-aitest-'));
const dbFile = path.join(tmpDir, 'ai-integration.db');

process.env.NODE_ENV = 'test';
process.env.WISHBOARD_DB_PATH = dbFile;
process.env.WISHBOARD_ADMIN_SECRET = 'itest-admin-passphrase';
process.env.ENABLE_AI_FEATURES = 'true';
process.env.AI_PROVIDER = 'local';

const request = (await import('supertest')).default;
const app = (await import('../../src/server/index.js')).default;
const { stopWatchingRules } = await import('../../src/server/rulesManager.js');
const { drainQueue, resetProviders } = await import('../../src/server/ai/index.js');
const db = (await import('../../src/server/db.js')).default;

afterAll(async () => {
  stopWatchingRules?.();
  resetProviders();
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

describe('integration: AI suggestion review and semantic search', () => {
  it('handles background tagging, suggestions retrieval, accept/reject/modify, and cleanup', async () => {
    // 1. Register a user to test authenticated wish flows
    const regRes = await request(app).post('/api/users/register').send({
      username: 'aiuser',
      passphrase: 'aiuser-passphrase',
    });
    expect(regRes.status).toBe(200);
    const userToken = regRes.body.token;

    // 2. Create wish anonymously with passphrase
    const createRes = await request(app).post('/api/wishes').send({
      content: 'I am a switch looking for a top to hang out',
      passphrase: 'wish-ai-passphrase',
    });
    expect(createRes.status).toBe(201);
    const wishId = createRes.body.id;
    expect(wishId).toBeTruthy();

    // 3. Await background tagging worker
    await drainQueue();

    // 4. Suggestions endpoint access control with passphrase
    const unauthRes = await request(app).get(`/api/wishes/${wishId}/suggestions`);
    expect(unauthRes.status).toBe(401);

    const wrongSecretRes = await request(app)
      .get(`/api/wishes/${wishId}/suggestions`)
      .query({ secret: 'wrong-passphrase' });
    expect(wrongSecretRes.status).toBe(403);

    // Valid query secret
    const querySecretRes = await request(app)
      .get(`/api/wishes/${wishId}/suggestions`)
      .query({ secret: 'wish-ai-passphrase' });
    expect(querySecretRes.status).toBe(200);
    expect(querySecretRes.body).toHaveLength(1);
    const suggestion = querySecretRes.body[0];
    expect(suggestion.status).toBe('pending');
    expect(suggestion.wish_id).toBe(wishId);

    // 5. Claim wish into user account
    const claimRes = await request(app)
      .post(`/api/wishes/${wishId}/claim`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ secret: 'wish-ai-passphrase' });
    expect(claimRes.status).toBe(200);

    // Check user wishes endpoint for AI suggestion indicators
    const meWishesRes = await request(app)
      .get('/api/users/me/wishes')
      .set('Authorization', `Bearer ${userToken}`);
    expect(meWishesRes.status).toBe(200);
    const myWish = meWishesRes.body.find((w) => w.id === wishId);
    expect(myWish).toBeDefined();
    expect(myWish.has_ai_suggestions).toBe(true);
    expect(myWish.pending_suggestions_count).toBeGreaterThan(0);

    // Valid bearer token on suggestions
    const tokenRes = await request(app)
      .get(`/api/wishes/${wishId}/suggestions`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body).toHaveLength(1);

    // 6. Accept suggestion
    const acceptRes = await request(app)
      .post(`/api/wishes/${wishId}/suggestions/accept`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.success).toBe(true);

    // Verify wish attributes updated
    const updatedWishRes = await request(app).get(`/api/wishes/${wishId}`);
    expect(updatedWishRes.status).toBe(200);

    // Suggestion status should now be accepted
    const reviewedSuggRes = await request(app)
      .get(`/api/wishes/${wishId}/suggestions`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(reviewedSuggRes.body[0].status).toBe('accepted');

    // 7. Test Reject flow on a second wish
    const wish2Res = await request(app)
      .post('/api/wishes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        content: 'I am a dominant looking for a submissive',
        passphrase: 'wish2-secret',
      });
    expect(wish2Res.status).toBe(201);
    const wish2Id = wish2Res.body.id;

    await drainQueue();

    const rejectRes = await request(app)
      .post(`/api/wishes/${wish2Id}/suggestions/reject`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(rejectRes.status).toBe(200);

    const wish2Sugg = await request(app)
      .get(`/api/wishes/${wish2Id}/suggestions`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(wish2Sugg.body[0].status).toBe('rejected');

    // 8. Test Modify flow on a third wish
    const wish3Res = await request(app).post('/api/wishes').send({
      content: 'Looking for board game buddies on Saturday',
      passphrase: 'wish3-secret',
    });
    expect(wish3Res.status).toBe(201);
    const wish3Id = wish3Res.body.id;

    // Manually insert a pending suggestion to test modify
    await db
      .prepare(
        'INSERT INTO wish_ai_suggestions (id, wish_id, suggested_creator_attributes, suggested_desired_attributes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        'sugg-3',
        wish3Id,
        JSON.stringify({}),
        JSON.stringify({}),
        'pending',
        new Date().toISOString(),
        new Date().toISOString()
      );

    const modifyRes = await request(app)
      .post(`/api/wishes/${wish3Id}/suggestions/modify`)
      .send({
        secret: 'wish3-secret',
        creator_attributes: { role: ['switch'] },
        desired_attributes: { role: ['versatile'] },
      });
    expect(modifyRes.status).toBe(200);

    // 9. Semantic search test
    const searchRes = await request(app)
      .get('/api/wishes')
      .query({ q: 'switch top partner', mode: 'semantic' });
    expect(searchRes.status).toBe(200);
    expect(Array.isArray(searchRes.body)).toBe(true);

    // 10. Deletion cleanup test
    const deleteRes = await request(app)
      .post(`/api/wishes/${wishId}/manage`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'delete' });
    expect(deleteRes.status).toBe(200);

    const remainingSuggestions = await db
      .prepare('SELECT COUNT(*) as count FROM wish_ai_suggestions WHERE wish_id = ?')
      .get(wishId);
    expect(remainingSuggestions.count).toBe(0);

    const remainingEmbeddings = await db
      .prepare('SELECT COUNT(*) as count FROM wish_embeddings WHERE wish_id = ?')
      .get(wishId);
    expect(remainingEmbeddings.count).toBe(0);
  });
});
