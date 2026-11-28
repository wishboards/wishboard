import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { isCompatible, validateRuleset } from '@wishboards/matching-engine';
import { LocalInferenceProvider } from '../../src/server/ai/LocalProvider.js';
import { sanitizeSvg } from '../../src/shared/svgSanitizer.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const LIFESTYLE_DIR = path.join(REPO_ROOT, 'profiles', 'lifestyle');

describe('lifestyle taxonomy offline & validation integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates profiles/lifestyle/rules.yaml with zero errors and all 5 rule types', () => {
    const rulesDoc = yaml.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'rules.yaml'), 'utf8'));
    const result = validateRuleset(rulesDoc.rules);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);

    const ruleTypes = new Set(rulesDoc.rules.map((r) => r.rule_type));
    expect(ruleTypes).toEqual(
      new Set(['enrichment', 'acceptance', 'expansion', 'cross_match', 'exclusion'])
    );

    const topBottomCross = rulesDoc.rules.find(
      (r) =>
        r.rule_type === 'cross_match' && r.trigger_value === 'top' && r.target_value === 'bottom'
    );
    const domSubCross = rulesDoc.rules.find(
      (r) =>
        r.rule_type === 'cross_match' &&
        r.trigger_value === 'dominant' &&
        r.target_value === 'submissive'
    );
    expect(topBottomCross).toBeDefined();
    expect(domSubCross).toBeDefined();

    // Verify Top/Bottom and Dominant/Submissive remain distinct in matching
    expect(
      isCompatible(
        {
          creator_attributes: { role: ['Top'] },
          desired_attributes: { role: ['Bottom'] },
        },
        { identity_attributes: { role: ['Submissive'] } },
        rulesDoc.rules
      )
    ).toBe(false);
  });

  it('verifies provenance manifest license gate and sanitized SVG sticker assets', () => {
    const provenance = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'profiles', 'provenance.json'), 'utf8')
    );

    expect(provenance.allowedLicenses).toEqual(['Apache-2.0', 'MIT', 'CC0-1.0']);
    expect(provenance.excludedLicenses).toEqual(['AGPL-3.0-or-later', 'CC BY-NC-SA 4.0']);

    const allowedSet = new Set(provenance.allowedLicenses);
    for (const src of provenance.approvedSources) {
      expect(allowedSet.has(src.license)).toBe(true);
    }
    const excludedSources = provenance.excludedSources.map((s) => s.source);
    expect(excludedSources).toContain('ContribuLibre/check-match');
    expect(excludedSources).toContain('microsoft/Pride-flag');

    const stickersDoc = yaml.parse(
      fs.readFileSync(path.join(LIFESTYLE_DIR, 'stickers.yaml'), 'utf8')
    );
    const imageSrcs = [];
    for (const catMap of Object.values(stickersDoc.stickers)) {
      for (const rule of Object.values(catMap)) {
        if (rule?.type === 'image' && typeof rule.src === 'string') {
          imageSrcs.push(rule.src);
        }
      }
    }

    expect(imageSrcs.length).toBeGreaterThanOrEqual(10);
    for (const src of imageSrcs) {
      expect(src.startsWith('/assets/stickers/')).toBe(true);
      const svgPath = path.join(LIFESTYLE_DIR, src.slice(1));
      expect(fs.existsSync(svgPath)).toBe(true);
      const rawSvg = fs.readFileSync(svgPath, 'utf8');
      expect(sanitizeSvg(rawSvg)).not.toBeNull();
    }
  });

  it('matches ENM/poly, LGBTQIA+, and BDSM/kink tags offline via LocalInferenceProvider with zero network calls', async () => {
    const profileDoc = yaml.parse(
      fs.readFileSync(path.join(LIFESTYLE_DIR, 'profile.yaml'), 'utf8')
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Network call attempted in offline LocalInferenceProvider test');
    });

    const provider = new LocalInferenceProvider();
    expect(provider.isAvailable()).toBe(true);

    const res = await provider.suggestAttributes({
      content:
        'I am a Queer Demisexual Service Top into Shibari and Kitchen Table Poly, looking for a Brat or Prey who enjoys Impact and Aromantic vibes.',
      taxonomy: profileDoc.categories,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.suggestedCreatorAttributes.orientation).toEqual(
      expect.arrayContaining(['Queer', 'Demisexual'])
    );
    expect(res.suggestedCreatorAttributes.role).toEqual(expect.arrayContaining(['Service Top']));
    expect(res.suggestedCreatorAttributes.interests).toEqual(expect.arrayContaining(['Shibari']));
    expect(res.suggestedCreatorAttributes.relationship_style).toEqual(
      expect.arrayContaining(['Kitchen Table Poly'])
    );

    expect(res.suggestedDesiredAttributes.role).toEqual(expect.arrayContaining(['Brat', 'Prey']));
    expect(res.suggestedDesiredAttributes.interests).toEqual(expect.arrayContaining(['Impact']));
    expect(res.suggestedDesiredAttributes.orientation).toEqual(
      expect.arrayContaining(['Aromantic'])
    );
  });
});
