/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import yaml from 'yaml';
import { validateRuleset } from '@wishboards/matching-engine';
import db from '../../src/server/db.js';
import { reloadRules, addRule } from '../../src/server/rulesManager.js';
import {
  clearProfileOverrides,
  setProfileOverride,
  getEffectiveEventProfile,
} from '../../src/server/configManager.js';
import { exportTaxonomyBundle } from '../../src/server/taxonomyExporter.js';
import { matchOrSynthesizeSticker } from '../../src/server/stickerMatcher.js';
import { LocalInferenceProvider } from '../../src/server/ai/LocalProvider.js';

describe('Cloud-to-Pi YAML/SVG Bundle Portability (Offline Integration)', () => {
  beforeEach(async () => {
    await clearProfileOverrides();
    await reloadRules();
    await db.prepare('DELETE FROM taxonomy_proposals').run();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearProfileOverrides();
    await db.prepare('DELETE FROM taxonomy_proposals').run();
  });

  it('applies a cloud-exported YAML/SVG bundle to an offline LocalInferenceProvider + configManager profile with 0 network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Network call attempted in offline bundle portability test');
    });

    // 1. Simulate cloud promotion + sticker synthesis
    const synthesized = matchOrSynthesizeSticker({
      label: 'Cloud Exported Tea',
      category: 'interests',
    });
    expect(synthesized.source).toBe('synthesized');

    await setProfileOverride('suggestions', { interests: ['Cloud Exported Tea'] });
    await setProfileOverride('stickers', {
      interests: {
        'Cloud Exported Tea': synthesized.sticker,
      },
    });
    await addRule({
      id: 'exp_cloud_tea_portability',
      rule_type: 'expansion',
      trigger_attribute: 'interests',
      trigger_value: 'tea-circle',
      context_attribute: null,
      context_value: null,
      target_attribute: 'interests',
      target_value: 'cloud exported tea',
    });

    const bundle = await exportTaxonomyBundle({ overridesOnly: true });
    expect(bundle.validation.valid).toBe(true);
    expect(bundle.assets['stickers/interests/Cloud Exported Tea.svg']).toContain('<svg');

    // 2. Simulate wiping DB and applying the exported bundle to an offline Pi instance
    await clearProfileOverrides();
    await db.prepare('DELETE FROM rules WHERE id = ?').run('exp_cloud_tea_portability');
    await reloadRules();

    const parsedProfile = yaml.parse(bundle.profileYaml);
    const parsedRules = yaml.parse(bundle.rulesYaml);
    const parsedStickers = yaml.parse(bundle.stickersYaml);

    const ruleCheck = validateRuleset(parsedRules.rules);
    expect(ruleCheck.valid).toBe(true);

    await setProfileOverride('categories', parsedProfile.categories);
    await setProfileOverride('stickers', parsedStickers.stickers);
    for (const rule of parsedRules.rules) {
      await addRule(rule);
    }

    const offlineEffective = await getEffectiveEventProfile();
    expect(offlineEffective.categories.find((c) => c.id === 'interests')?.suggestions).toContain(
      'Cloud Exported Tea'
    );
    expect(offlineEffective.stickers.interests['Cloud Exported Tea']?.type).toBe('svg');
    expect(offlineEffective.stickers.interests['Cloud Exported Tea']?.svg).toContain('<svg');

    // 3. Offline LocalInferenceProvider runs with 0 network calls
    const localProvider = new LocalInferenceProvider();
    const suggestions = await localProvider.suggestAttributes({
      content: 'Looking for Cloud Exported Tea and shibari friends',
      taxonomy: offlineEffective.categories,
      stickers: offlineEffective.stickers,
    });
    expect(suggestions).toBeTruthy();
    const matchedInterests = [
      ...(suggestions.suggestedCreatorAttributes?.interests || []),
      ...(suggestions.suggestedDesiredAttributes?.interests || []),
    ];
    expect(matchedInterests).toContain('Cloud Exported Tea');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
