import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db, { closeDb } from '../db.js';

describe('Wishes Exclusions Bulk Import', () => {
  let userToken;
  let wishIds = [];

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await db.execute('DELETE FROM wish_exclusions');
    await db.execute('DELETE FROM wishes');
    await db.execute('DELETE FROM users');

    // Register and login a user
    await request(app)
      .post('/api/users/register')
      .send({ username: 'testuser_bulk_exclusions', passphrase: 'testpassword' });

    const loginRes = await request(app)
      .post('/api/users/login')
      .send({ username: 'testuser_bulk_exclusions', passphrase: 'testpassword' });
    userToken = loginRes.body.token;

    // Create a few wishes
    wishIds = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/wishes')
        .send({ content: `Test Wish ${i}` });
      wishIds.push(res.body.id);
    }
  });

  it('successfully bulk imports valid exclusions', async () => {
    const res = await request(app)
      .post('/api/wishes/exclusions/import')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: wishIds });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const exclusionsRes = await request(app)
      .get('/api/wishes/exclusions/list')
      .set('Authorization', `Bearer ${userToken}`);

    expect(exclusionsRes.body).toHaveLength(3);
    expect(exclusionsRes.body).toEqual(expect.arrayContaining(wishIds));
  });

  it('ignores invalid or non-existent wish IDs', async () => {
    const mixedIds = [wishIds[0], 'nonexistent-id', wishIds[1]];
    const res = await request(app)
      .post('/api/wishes/exclusions/import')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: mixedIds });

    expect(res.status).toBe(200);

    const exclusionsRes = await request(app)
      .get('/api/wishes/exclusions/list')
      .set('Authorization', `Bearer ${userToken}`);

    expect(exclusionsRes.body).toHaveLength(2);
    expect(exclusionsRes.body).toEqual(expect.arrayContaining([wishIds[0], wishIds[1]]));
  });

  it('handles database errors gracefully during bulk insert', async () => {
    await db.execute('DROP TABLE wish_exclusions');
    const res = await request(app)
      .post('/api/wishes/exclusions/import')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ids: wishIds });
    expect(res.status).toBe(200);

    // recreate table for other tests just in case
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS wish_exclusions (
        user_id TEXT NOT NULL,
        wish_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, wish_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
      );
    `);
  });
});
