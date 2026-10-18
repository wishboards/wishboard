/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Each test re-imports against a fresh in-memory DB (db.js uses :memory: under
// NODE_ENV=test), which rulesManager auto-seeds with the bundled defaults on boot.
const importFresh = async (env = {}) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const db = (await import('./db.js')).default;
  const rm = await import('./rulesManager.js');
  return { db, rm };
};

const { createRule } = await import('../../tests/testUtils.ts');

const fullRule = (over = {}) =>
  createRule('rule-1', 'expansion', 'gender', 'gender', 'woman', 'woman, female', over);

const insertDirect = (db, id) =>
  db.execute({
    sql: 'INSERT INTO rules (id, rule_type, trigger_attribute, trigger_value, target_attribute, target_value) VALUES (?,?,?,?,?,?)',
    args: [id, 'expansion', 'gender', 'woman', 'gender', 'women'],
  });

describe('rulesManager (DB-backed)', () => {
  let db;
  let rm;

  beforeEach(async () => {
    ({ db, rm } = await importFresh());
  });

  afterEach(() => {
    delete process.env.RULES_CACHE_TTL_MS;
  });

  it('seeds the 51 bundled default rules into a fresh database on boot', () => {
    expect(rm.getRules()).toHaveLength(51);
  });

  it('seedIfEmpty is a no-op when rules already exist', async () => {
    await rm.seedIfEmpty();
    expect(rm.getRules()).toHaveLength(51); // not doubled
  });

  it('seedIfEmpty repopulates an empty table with the defaults', async () => {
    await db.execute('DELETE FROM rules');
    await rm.seedIfEmpty();
    await rm.reloadRules();
    expect(rm.getRules()).toHaveLength(51);
  });

  describe('CRUD against an empty table', () => {
    beforeEach(async () => {
      await db.execute('DELETE FROM rules');
      await rm.reloadRules();
      expect(rm.getRules()).toEqual([]);
    });

    it('addRule inserts and updates the cache + DB', async () => {
      await rm.addRule(fullRule());
      expect(rm.getRules()).toHaveLength(1);
      await rm.reloadRules();
      expect(rm.getRules()[0].id).toBe('rule-1');
    });

    it('updateRule merges fields and persists', async () => {
      await rm.addRule(fullRule());
      expect(await rm.updateRule('rule-1', { trigger_value: 'man' })).toBe(true);
      await rm.reloadRules();
      expect(rm.getRules()[0].trigger_value).toBe('man');
    });

    it('updateRule returns false for an unknown id', async () => {
      expect(await rm.updateRule('nope', { trigger_value: 'x' })).toBe(false);
    });

    it('deleteRule removes from the cache + DB', async () => {
      await rm.addRule(fullRule());
      expect(await rm.deleteRule('rule-1')).toBe(true);
      await rm.reloadRules();
      expect(rm.getRules()).toEqual([]);
    });

    it('deleteRule returns false for an unknown id', async () => {
      expect(await rm.deleteRule('nope')).toBe(false);
    });
  });

  it('reloadRules picks up changes written directly to the DB', async () => {
    await db.execute('DELETE FROM rules');
    await rm.reloadRules();
    await insertDirect(db, 'ext-1');
    await rm.reloadRules();
    expect(rm.getRules().map((r) => r.id)).toContain('ext-1');
  });

  it('getRules triggers a background reload once the cache is stale (TTL)', async () => {
    ({ db, rm } = await importFresh({ RULES_CACHE_TTL_MS: '0' }));
    await db.execute('DELETE FROM rules');
    await rm.reloadRules();
    expect(rm.getRules()).toHaveLength(0);

    // Another instance writes a rule straight to the shared DB.
    await insertDirect(db, 'ext-2');

    // TTL=0 means the cache is immediately stale, so getRules kicks a background
    // reload (fire-and-forget). Poll until that reload lands the external change.
    await vi.waitFor(
      () => {
        rm.getRules(); // trigger the background refresh
        expect(rm.getRules().map((r) => r.id)).toContain('ext-2');
      },
      { timeout: 1000, interval: 20 }
    );
  });

  it('migrates a legacy rules.yaml (RULES_PATH) into the DB on first boot, preserving customizations', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'wb-rules-mig-'));
    const yamlPath = pathMod.join(dir, 'rules.yaml');
    fs.writeFileSync(
      yamlPath,
      [
        'rules:',
        '  - id: custom_pet',
        '    rule_type: expansion',
        '    trigger_attribute: role',
        '    trigger_value: pet',
        '    target_attribute: role',
        '    target_value: pup',
      ].join('\n') + '\n',
      'utf8'
    );

    ({ db, rm } = await importFresh({ RULES_PATH: yamlPath }));

    // Seeded from the legacy file, not the 51 bundled defaults.
    expect(rm.getRules()).toHaveLength(1);
    expect(rm.getRules().map((r) => r.id)).toContain('custom_pet');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stopWatchingRules is a no-op (file watcher removed with the DB migration)', () => {
    expect(() => rm.stopWatchingRules()).not.toThrow();
  });

  it('falls back to bundled defaults when legacy rules.yaml contains invalid YAML', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'wb-rules-bad-'));
    const yamlPath = pathMod.join(dir, 'rules.yaml');
    fs.writeFileSync(yamlPath, 'rules: [invalid: : : yaml]', 'utf8');

    ({ db, rm } = await importFresh({ RULES_PATH: yamlPath }));

    // Should log warning and fall back to bundled 51 defaults
    expect(rm.getRules()).toHaveLength(51);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to bundled defaults when legacy rules.yaml contains empty rules array', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'wb-rules-empty-'));
    const yamlPath = pathMod.join(dir, 'rules.yaml');
    fs.writeFileSync(yamlPath, 'rules: []\n', 'utf8');

    ({ db, rm } = await importFresh({ RULES_PATH: yamlPath }));

    expect(rm.getRules()).toHaveLength(51);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not trigger reload when cache TTL is fresh', async () => {
    ({ db, rm } = await importFresh({ RULES_CACHE_TTL_MS: '600000' }));
    await db.execute('DELETE FROM rules');
    await rm.reloadRules();
    expect(rm.getRules()).toHaveLength(0);

    await insertDirect(db, 'ext-3');

    // Cache is fresh, getRules does not pick up ext-3 synchronously or async
    rm.getRules();
    expect(rm.getRules()).toHaveLength(0);
  });
});
