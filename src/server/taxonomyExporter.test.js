/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import yaml from 'yaml';
import db from './db.js';
import { reloadRules, addRule } from './rulesManager.js';
import { clearProfileOverrides, setProfileOverride } from './configManager.js';
import { exportTaxonomyBundle } from './taxonomyExporter.js';
import { harvestSignals } from './proposalsManager.js';

describe('taxonomyExporter', () => {
  beforeEach(async () => {
    await clearProfileOverrides();
    await reloadRules();
    await db.prepare('DELETE FROM taxonomy_proposals').run();
  });

  afterEach(async () => {
    await clearProfileOverrides();
    await db.prepare('DELETE FROM taxonomy_proposals').run();
  });

  it('exports full effective profile with deterministic YAML, sanitized SVG assets, and valid ruleset', async () => {
    const bundle1 = await exportTaxonomyBundle({ overridesOnly: false });
    const bundle2 = await exportTaxonomyBundle({ overridesOnly: false });

    expect(bundle1.overridesOnly).toBe(false);
    expect(bundle1.validation.valid).toBe(true);
    expect(bundle1.validation.errors).toEqual([]);
    expect(bundle1.rulesYaml).toBe(bundle2.rulesYaml);
    expect(bundle1.stickersYaml).toBe(bundle2.stickersYaml);
    expect(bundle1.profileYaml).toBe(bundle2.profileYaml);
    expect(Object.keys(bundle1.assets).length).toBeGreaterThan(0);

    for (const svg of Object.values(bundle1.assets)) {
      expect(svg).toContain('<svg');
      expect(svg).not.toContain('<script');
    }

    expect(() => yaml.parse(bundle1.profileYaml)).not.toThrow();
    expect(() => yaml.parse(bundle1.rulesYaml)).not.toThrow();
    expect(() => yaml.parse(bundle1.stickersYaml)).not.toThrow();
    expect(() => yaml.parse(bundle1.yaml)).not.toThrow();
  });

  it('exports overridesOnly bundle with approved overrides and never leaks pending proposals', async () => {
    await harvestSignals([
      {
        proposal_type: 'suggestion',
        key: 'secret-pending-leak',
        payload: { categoryId: 'interests', label: 'Secret Pending Leak' },
      },
    ]);

    await setProfileOverride('suggestions', { interests: ['Tea Lounge'] });
    await setProfileOverride('stickers', {
      interests: {
        'Tea Lounge': {
          type: 'svg',
          svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#6366f1" /><script>alert(1)</script></svg>',
        },
      },
    });
    await addRule({
      id: 'exp_tea_lounge_test',
      rule_type: 'expansion',
      trigger_attribute: 'interests',
      trigger_value: 'tea-room',
      context_attribute: null,
      context_value: null,
      target_attribute: 'interests',
      target_value: 'tea lounge',
    });

    const bundle = await exportTaxonomyBundle({ overridesOnly: true });
    expect(bundle.overridesOnly).toBe(true);
    expect(bundle.validation.valid).toBe(true);
    expect(bundle.rulesYaml).toContain('exp_tea_lounge_test');
    expect(bundle.stickersYaml).toContain('Tea Lounge');
    expect(bundle.assets['stickers/interests/Tea Lounge.svg']).toContain('<svg');
    expect(bundle.assets['stickers/interests/Tea Lounge.svg']).not.toContain('<script');

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('secret-pending-leak');
    expect(serialized).not.toContain('Secret Pending Leak');
  });

  it('sanitizes category and term segments in bundle.assets keys to prevent path traversal', async () => {
    await setProfileOverride('stickers', {
      '../interests': {
        '../../evil': {
          type: 'svg',
          svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#6366f1" /></svg>',
        },
      },
    });

    const bundle = await exportTaxonomyBundle({ overridesOnly: true });
    const assetKeys = Object.keys(bundle.assets);
    expect(assetKeys).toContain('stickers/interests/evil.svg');
    for (const key of assetKeys) {
      expect(key).not.toContain('..');
    }
  });
});
