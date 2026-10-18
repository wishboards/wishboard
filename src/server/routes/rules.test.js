/** @vitest-environment node */
process.env.NODE_ENV = 'test';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const db = (await import('../db.js')).default;
const app = appModule.default;
const { reloadRules } = await import('../rulesManager.js');
const { createRulePayload } = await import('../../../tests/testUtils.ts');

const defaultAdminUsername = 'admin';
const defaultAdminSecret = 'admin-board';

const clearTestData = async () => {
  await db.exec('DELETE FROM sessions');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
  await db.exec('DELETE FROM rules');
  await reloadRules();
};

beforeEach(async () => await clearTestData());
afterEach(async () => await clearTestData());

describe('rules routes', () => {
  const sampleRule = createRulePayload('expansion', 'role', 'role', 'pet', 'pup');
  const updatedRule = createRulePayload('expansion', 'role', 'role', 'pet', 'pup, kitten');

  const loginAsAdmin = async () => {
    const response = await request(app)
      .post('/api/users/login')
      .send({ username: defaultAdminUsername, passphrase: defaultAdminSecret })
      .set('Accept', 'application/json');
    return response.body.token;
  };

  const loginAsUser = async () => {
    await request(app)
      .post('/api/users/register')
      .send({ username: 'testuser', passphrase: 'password' });
    const response = await request(app)
      .post('/api/users/login')
      .send({ username: 'testuser', passphrase: 'password' });
    return response.body.token;
  };

  it('allows admin to get rules', async () => {
    const token = await loginAsAdmin();
    const res = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('forbids non-admin from getting rules', async () => {
    const token = await loginAsUser();
    const res = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows admin to add a rule', async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleRule);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    const getRes = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(getRes.body).toHaveLength(1);
    expect(getRes.body[0].trigger_value).toBe('pet');
  });

  it('allows admin to update a rule', async () => {
    const token = await loginAsAdmin();
    const createRes = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleRule);
    const ruleId = createRes.body.id;

    const updateRes = await request(app)
      .put(`/api/rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(updatedRule);

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);

    const getRes = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(getRes.body[0].target_value).toBe('pup, kitten');
  });

  it('returns 404 when updating non-existent rule', async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .put('/api/rules/missing-id')
      .set('Authorization', `Bearer ${token}`)
      .send(updatedRule);
    expect(res.status).toBe(404);
  });

  it('handles malformed updates gracefully', async () => {
    const token = await loginAsAdmin();
    const createRes = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleRule);

    const res = await request(app)
      .put(`/api/rules/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('allows admin to delete a rule', async () => {
    const token = await loginAsAdmin();
    const createRes = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleRule);
    const ruleId = createRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(getRes.body).toHaveLength(0);
  });

  it('returns 404 when deleting non-existent rule', async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .delete('/api/rules/missing-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
