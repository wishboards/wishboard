/** @vitest-environment node */
process.env.NODE_ENV = 'test';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const request = (await import('supertest')).default;
const appModule = await import('../index.js');
const db = (await import('../db.js')).default;
const app = appModule.default;
const { reloadRules, addRule } = await import('../rulesManager.js');
const { createRulePayload, createRule } = await import('../../../tests/testUtils.ts');

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
    expect(res.body).toEqual({ error: 'Rule not found' });
  });

  it('returns the exact 404 body when updating a non-existent rule', async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .put('/api/rules/missing-id')
      .set('Authorization', `Bearer ${token}`)
      .send(updatedRule);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Rule not found' });
  });

  it('creates a rule with the exact success body and a rule_ id', async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleRule);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      id: expect.stringMatching(/^rule_[a-z0-9]{8}$/),
    });
  });

  it('returns the exact success body when updating and deleting a rule', async () => {
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
    expect(updateRes.body).toEqual({ success: true });

    const deleteRes = await request(app)
      .delete(`/api/rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.body).toEqual({ success: true });
  });

  const requiredFields = [
    'rule_type',
    'trigger_attribute',
    'trigger_value',
    'target_attribute',
    'target_value',
  ];

  it.each(requiredFields)(
    'rejects a create missing only %s with the exact 400 body',
    async (field) => {
      const token = await loginAsAdmin();
      const payload = { ...sampleRule };
      delete payload[field];
      const res = await request(app)
        .post('/api/rules')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing required fields' });
    }
  );

  it.each(requiredFields)(
    'rejects an update missing only %s with the exact 400 body',
    async (field) => {
      const token = await loginAsAdmin();
      const payload = { ...updatedRule };
      delete payload[field];
      const res = await request(app)
        .put('/api/rules/some-id')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing required fields' });
    }
  );

  it('stores context fields as null when omitted and preserves them when given', async () => {
    const token = await loginAsAdmin();
    await request(app).post('/api/rules').set('Authorization', `Bearer ${token}`).send(sampleRule);
    await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...sampleRule,
        trigger_value: 'with-context',
        context_attribute: 'gender',
        context_value: 'man',
      });

    const getRes = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(getRes.body).toHaveLength(2);
    const withoutContext = getRes.body.find((r) => r.trigger_value === 'pet');
    expect(withoutContext.context_attribute).toBeNull();
    expect(withoutContext.context_value).toBeNull();
    const withContext = getRes.body.find((r) => r.trigger_value === 'with-context');
    expect(withContext.context_attribute).toBe('gender');
    expect(withContext.context_value).toBe('man');
  });

  it('update stores context fields as null when omitted and preserves them when given', async () => {
    const token = await loginAsAdmin();
    const createRes = await request(app)
      .post('/api/rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...sampleRule,
        context_attribute: 'gender',
        context_value: 'man',
      });
    const ruleId = createRes.body.id;

    await request(app)
      .put(`/api/rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(updatedRule);
    let getRes = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(getRes.body[0].context_attribute).toBeNull();
    expect(getRes.body[0].context_value).toBeNull();

    await request(app)
      .put(`/api/rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...updatedRule, context_attribute: 'gender', context_value: 'woman' });
    getRes = await request(app).get('/api/rules').set('Authorization', `Bearer ${token}`);
    expect(getRes.body[0].context_attribute).toBe('gender');
    expect(getRes.body[0].context_value).toBe('woman');
  });

  describe('check-conflicts normalization', () => {
    const seedExclRules = async () => {
      await addRule(
        createRule('rule_ex_1', 'exclusion', 'orientation', 'orientation', 'gay', 'straight')
      );
      await addRule(
        createRule('rule_ex_2', 'exclusion', 'orientation', 'gender', 'lesbian', 'man', {
          context_attribute: 'gender',
          context_value: 'man',
        })
      );
      await addRule(createRule('rule_ex_3', 'exclusion', 'role', 'role', '42', '43'));
      await reloadRules();
    };

    const checkConflicts = (attributes) =>
      request(app)
        .post('/api/rules/check-conflicts')
        .send({ attributes })
        .set('Accept', 'application/json');

    it('accepts comma-separated string attributes', async () => {
      await seedExclRules();
      const res = await checkConflicts({ gender: 'man', orientation: 'lesbian', role: '' });
      expect(res.status).toBe(200);
      expect(res.body.conflicts).toHaveLength(1);
    });

    it('splits, trims and drops empty segments from string attributes', async () => {
      await seedExclRules();
      const res = await checkConflicts({
        gender: 'woman',
        orientation: ' gay , , straight ',
        role: '',
      });
      expect(res.status).toBe(200);
      expect(res.body.conflicts).toHaveLength(1);
    });

    it('coerces non-string array entries to strings', async () => {
      await seedExclRules();
      const res = await checkConflicts({ gender: [], orientation: [], role: [42, 43] });
      expect(res.status).toBe(200);
      expect(res.body.conflicts).toHaveLength(1);
    });

    it('treats non-string, non-array attribute values as empty', async () => {
      await seedExclRules();
      const res = await checkConflicts({ gender: 42, orientation: 'lesbian', role: null });
      expect(res.status).toBe(200);
      expect(res.body.conflicts).toEqual([]);
    });
  });
});
