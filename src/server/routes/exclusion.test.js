/** @vitest-environment node */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmpRulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishboard-exclusions-'));
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
const { getExclusionConflicts, normalizeToken, escapeRegExp, hasToken } =
  await import('./wishes.js');
const { createRule } = await import('../../../tests/testUtils.ts');

const clearTestData = async () => {
  await db.exec('DELETE FROM sessions');
  await db.exec('DELETE FROM wishes');
  await db.exec("DELETE FROM users WHERE role != 'admin'");
  await db.exec('DELETE FROM rules');
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

describe('Write-Time Exclusion Rules', () => {
  const seedExclRules = async () => {
    // Add default test expansion and exclusion rules
    // Excl 1: gay + straight (orientation vs orientation)
    await addRule(
      createRule('rule_ex_1', 'exclusion', 'orientation', 'orientation', 'gay', 'straight')
    );
    // Excl 2: lesbian + man (orientation vs gender context)
    await addRule(
      createRule('rule_ex_2', 'exclusion', 'orientation', 'gender', 'lesbian', 'man', {
        context_attribute: 'gender',
        context_value: 'man',
      })
    );
    // Expansion: enby synonym
    await addRule(
      createRule('rule_exp_1', 'expansion', 'gender', 'gender', 'enby', 'nonbinary, non-binary')
    );
    await reloadRules();
  };

  describe('getExclusionConflicts Logic Unit Tests', () => {
    it('returns empty array when there are no conflicts', async () => {
      await seedExclRules();
      const rules = await db.prepare('SELECT * FROM rules').all();
      const conflicts = getExclusionConflicts(
        {
          gender: ['woman'],
          orientation: ['lesbian'],
          role: ['dominant'],
        },
        rules
      );
      expect(conflicts).toEqual([]);
    });

    it('detects simple orientation vs orientation conflicts', async () => {
      await seedExclRules();
      const rules = await db.prepare('SELECT * FROM rules').all();
      const conflicts = getExclusionConflicts(
        {
          gender: ['man'],
          orientation: ['gay', 'straight'],
          role: ['switch'],
        },
        rules
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].trigger_attribute).toBe('orientation');
      expect(conflicts[0].target_attribute).toBe('orientation');
      expect(conflicts[0].message).toContain('mutually exclusive');
    });

    it('detects context-based orientation vs gender conflicts', async () => {
      await seedExclRules();
      const rules = await db.prepare('SELECT * FROM rules').all();
      const conflicts = getExclusionConflicts(
        {
          gender: ['man'],
          orientation: ['lesbian'],
          role: ['top'],
        },
        rules
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].trigger_attribute).toBe('orientation');
      expect(conflicts[0].target_attribute).toBe('gender');
      expect(conflicts[0].message).toContain('mutually exclusive');
    });

    it('supports synonym resolution/expansion when evaluating conflicts', async () => {
      await seedExclRules();
      // Let's add a rule: nonbinary is mutually exclusive with man
      await db.execute({
        sql: 'INSERT INTO rules (id, rule_type, trigger_attribute, trigger_value, target_attribute, target_value) VALUES (?,?,?,?,?,?)',
        args: ['rule_ex_3', 'exclusion', 'gender', 'nonbinary', 'gender', 'man'],
      });
      await reloadRules();
      const rules = await db.prepare('SELECT * FROM rules').all();

      // The user passes "enby" and "man". Since "enby" expands to "nonbinary", this should trigger a conflict
      const conflicts = getExclusionConflicts(
        {
          gender: ['enby', 'man'],
          orientation: ['queer'],
          role: [],
        },
        rules
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].trigger_value).toBe('nonbinary');
      expect(conflicts[0].target_value).toBe('man');
    });

    it('conflict objects include null context_attribute/context_value when rule has no context', async () => {
      await seedExclRules();
      // rule_ex_1 has no context (gay vs straight, orientation vs orientation)
      const rules = await db.prepare('SELECT * FROM rules').all();
      const conflicts = getExclusionConflicts(
        { gender: ['man'], orientation: ['gay', 'straight'], role: [] },
        rules
      );
      expect(conflicts).toHaveLength(1);
      // null (not undefined) is the expected sentinel for absent context fields
      expect(conflicts[0].context_attribute).toBeNull();
      expect(conflicts[0].context_value).toBeNull();
    });

    it('conflict objects include context_attribute/context_value when rule has context', async () => {
      await seedExclRules();
      // rule_ex_2: lesbian + man (orientation vs gender with context gender=man)
      const rules = await db.prepare('SELECT * FROM rules').all();
      const conflicts = getExclusionConflicts(
        { gender: ['man'], orientation: ['lesbian'], role: [] },
        rules
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].context_attribute).toBe('gender');
      expect(conflicts[0].context_value).toBe('man');
    });

    it('returns no conflicts for empty attribute arrays', async () => {
      await seedExclRules();
      const rules = await db.prepare('SELECT * FROM rules').all();
      const conflicts = getExclusionConflicts({ gender: [], orientation: [], role: [] }, rules);
      expect(conflicts).toEqual([]);
    });

    it('returns no conflicts when no exclusion rules exist', async () => {
      // No seed — rules table is empty after clearTestData
      await reloadRules();
      const rules = await db.prepare('SELECT * FROM rules').all();
      const exclusionRules = rules.filter((r) => r.rule_type === 'exclusion');
      expect(exclusionRules).toHaveLength(0);
      const conflicts = getExclusionConflicts(
        { gender: ['man'], orientation: ['lesbian'], role: [] },
        rules
      );
      expect(conflicts).toEqual([]);
    });
  });

  describe('Helper: normalizeToken', () => {
    it('lowercases and trims the input string', () => {
      expect(normalizeToken('  LESBIAN  ')).toBe('lesbian');
      expect(normalizeToken('Gay')).toBe('gay');
      expect(normalizeToken('NonBinary')).toBe('nonbinary');
    });

    it('converts falsy values to an empty string (not undefined)', () => {
      expect(normalizeToken(null)).toBe('');
      expect(normalizeToken(undefined)).toBe('');
      expect(normalizeToken('')).toBe('');
      // Must be a string, not undefined (kills ArrowFunction → ()=>undefined mutant)
      expect(typeof normalizeToken(null)).toBe('string');
    });

    it('coerces non-string values via String()', () => {
      expect(normalizeToken(42)).toBe('42');
    });
  });

  describe('Helper: escapeRegExp', () => {
    it('escapes special regex characters', () => {
      expect(escapeRegExp('a.b')).toBe(String.raw`a\.b`);
      expect(escapeRegExp('rope-bunny')).toBe('rope-bunny');
      expect(escapeRegExp('(pet)')).toBe(String.raw`\(pet\)`);
    });
  });

  describe('Helper: hasToken', () => {
    it('matches a whole word token (case-insensitive)', () => {
      expect(hasToken('lesbian', 'lesbian')).toBe(true);
      expect(hasToken('Lesbian woman', 'lesbian')).toBe(true);
    });

    it('does not match partial words', () => {
      // "gay" should not match "gayman" mid-word
      expect(hasToken('gayman', 'gay')).toBe(false);
    });

    it('is case-insensitive — kills the StringLiteral mutant that removes the "i" flag', () => {
      // The StringLiteral mutant replaces 'i' with '' making the regex case-sensitive.
      // These assertions fail if case-insensitivity is removed:
      expect(hasToken('LESBIAN', 'lesbian')).toBe(true);
      expect(hasToken('lesbian', 'LESBIAN')).toBe(true);
      expect(hasToken('GAY STRAIGHT', 'gay')).toBe(true);
    });

    it('returns false when the haystack does not contain the token', () => {
      expect(hasToken('straight', 'gay')).toBe(false);
      expect(hasToken('', 'gay')).toBe(false);
    });
  });

  describe('Route: POST /api/rules/check-conflicts', () => {
    it('is publicly accessible and returns conflicts format', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/rules/check-conflicts')
        .send({
          attributes: {
            gender: ['man'],
            orientation: ['lesbian'],
            role: [],
          },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.conflicts).toBeDefined();
      expect(response.body.conflicts).toHaveLength(1);
      expect(response.body.conflicts[0].message).toContain('mutually exclusive');
    });

    it('returns empty conflicts list for valid attributes', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/rules/check-conflicts')
        .send({
          attributes: {
            gender: ['woman'],
            orientation: ['lesbian'],
            role: [],
          },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.conflicts).toEqual([]);
    });
  });

  describe('Route: POST /api/users/register', () => {
    it('blocks registration when user identity attributes conflict', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/users/register')
        .send({
          username: 'conflict_reg',
          passphrase: 'secret_password',
          identity_attributes: { gender: ['man'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('conflict');
    });

    it('permits registration with valid attributes', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/users/register')
        .send({
          username: 'valid_reg',
          passphrase: 'secret_password',
          identity_attributes: { gender: ['woman'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
    });
  });

  describe('Route: PUT /api/users/me', () => {
    const registerAndLogin = async (username) => {
      await request(app)
        .post('/api/users/register')
        .send({ username, passphrase: 'password123' })
        .set('Accept', 'application/json');

      const login = await request(app)
        .post('/api/users/login')
        .send({ username, passphrase: 'password123' })
        .set('Accept', 'application/json');

      return login.body.token;
    };

    it('blocks updating profile if new attributes conflict', async () => {
      await seedExclRules();
      const token = await registerAndLogin('user_update_test');

      const updateResponse = await request(app)
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          identity_attributes: { gender: ['man'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(updateResponse.status).toBe(400);
      expect(updateResponse.body.error).toContain('conflict');
    });

    it('allows updating profile with valid attributes', async () => {
      await seedExclRules();
      const token = await registerAndLogin('user_update_test_2');

      const updateResponse = await request(app)
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          identity_attributes: { gender: ['woman'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(updateResponse.status).toBe(200);
    });
  });

  describe('Route: POST /api/wishes', () => {
    const registerAndLogin = async (username) => {
      await request(app)
        .post('/api/users/register')
        .send({ username, passphrase: 'password123' })
        .set('Accept', 'application/json');

      const login = await request(app)
        .post('/api/users/login')
        .send({ username, passphrase: 'password123' })
        .set('Accept', 'application/json');

      return login.body.token;
    };

    it('blocks anonymous wish creation if creator attributes conflict', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/wishes')
        .send({
          content: 'Test conflict wish',
          creator_attributes: { gender: ['man'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Creator attributes conflict');
    });

    it('blocks anonymous wish creation if desired attributes conflict', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/wishes')
        .send({
          content: 'Test conflict wish 2',
          desired_attributes: { gender: ['man'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Desired criteria conflict');
    });

    it('permits anonymous wish creation with valid attributes', async () => {
      await seedExclRules();
      const response = await request(app)
        .post('/api/wishes')
        .send({
          content: 'Test valid wish',
          creator_attributes: { gender: ['woman'], orientation: ['lesbian'] },
          desired_attributes: { gender: ['woman'], orientation: ['lesbian'] },
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(201);
    });

    it('blocks authenticated wish creation if user profile attributes conflict', async () => {
      await seedExclRules();
      // Register with valid profile, then we manually insert a conflict in profile (e.g. before rule was seeded)
      // or we just register validly, add conflict rules, then try to create a wish where profile is now in conflict
      const token = await registerAndLogin('user_wish_test');

      // Seed conflicting attributes to this user directly in the DB bypass
      await db.execute({
        sql: 'UPDATE users SET identity_attributes = ? WHERE username = ?',
        args: [JSON.stringify({ gender: ['man'], orientation: ['lesbian'] }), 'user_wish_test'],
      });

      const response = await request(app)
        .post('/api/wishes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'Should be blocked',
        })
        .set('Accept', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Creator attributes conflict');
    });
  });
});
