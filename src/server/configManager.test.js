import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getEventProfile,
  getDomainConfig,
  clearConfigCache,
  validateBranding,
  DEFAULT_BRANDING,
  getEffectiveEventProfile,
  invalidateEffectiveProfileCache,
  setProfileOverride,
  deleteProfileOverride,
  clearProfileOverrides,
} from './configManager.js';
import db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('configManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EVENT_PROFILE_PATH;
    delete process.env.EVENT_PROFILE;
    clearConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
    vi.restoreAllMocks();
  });

  it('loads default profile config when no environment variables are set', () => {
    const config = getEventProfile();
    expect(config).toBeDefined();
    expect(config.profile).toBeDefined();
    expect(Array.isArray(config.contact_methods)).toBe(true);
  });

  it('returns cached config on subsequent calls until clearConfigCache is invoked', () => {
    const config1 = getEventProfile();
    const config2 = getEventProfile();
    expect(config1).toBe(config2);

    clearConfigCache();
    const config3 = getEventProfile();
    expect(config3).not.toBe(config1); // Fresh reference after clear
  });

  it('supports getDomainConfig alias', () => {
    expect(getDomainConfig).toBe(getEventProfile);
  });

  it('uses EVENT_PROFILE_PATH when provided', () => {
    process.env.EVENT_PROFILE_PATH = 'profiles/professional/profile.yaml';
    const config = getEventProfile();
    expect(config.profile).toBe('professional');
  });

  it('uses EVENT_PROFILE env variable when set', () => {
    process.env.EVENT_PROFILE = 'professional';
    const config = getEventProfile();
    expect(config.profile).toBe('professional');
  });

  it('falls back to bundledPath when repoPath does not exist', () => {
    const repoPath = path.resolve(process.cwd(), 'profiles', 'lifestyle', 'profile.yaml');
    const bundledPath = path.resolve(__dirname, 'profile.yaml');

    const originalExistsSync = fs.existsSync;
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === repoPath) return false;
      if (p === bundledPath) return true;
      return originalExistsSync(p);
    });

    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (p === bundledPath) {
        return 'profile: bundled\ncontact_methods:\n  - Email\n';
      }
      return originalExistsSync(p, enc);
    });

    const config = getEventProfile();
    expect(config.profile).toBe('bundled');
    expect(existsSpy).toHaveBeenCalled();
    expect(readSpy).toHaveBeenCalledWith(bundledPath, 'utf8');
  });

  it('loads split stickers.yaml and rules.yaml from bundled directory when repoPath does not exist', () => {
    const repoPath = path.resolve(process.cwd(), 'profiles', 'lifestyle', 'profile.yaml');
    const bundledProfile = path.resolve(__dirname, 'profile.yaml');
    const bundledStickers = path.resolve(__dirname, 'stickers.yaml');
    const bundledRules = path.resolve(__dirname, 'rules.yaml');

    const originalExistsSync = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === repoPath) return false;
      if (p === bundledProfile || p === bundledStickers || p === bundledRules) return true;
      return originalExistsSync(p);
    });

    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (p === bundledProfile) {
        return 'profile: bundled\ncontact_methods:\n  - Email\n';
      }
      if (p === bundledStickers) {
        return 'stickers:\n  orientation:\n    gay: { type: heart, class: flag-rainbow }\n';
      }
      if (p === bundledRules) {
        return 'rules:\n  - id: bundled_rule\n    rule_type: expansion\n    trigger_attribute: test\n    trigger_value: test\n    target_attribute: test\n    target_value: test\n';
      }
      return originalReadFileSync(p, enc);
    });

    const config = getEventProfile();
    expect(config.profile).toBe('bundled');
    expect(config.stickers).toBeDefined();
    expect(config.stickers?.orientation?.gay).toEqual({ type: 'heart', class: 'flag-rainbow' });
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].id).toBe('bundled_rule');
  });

  it('populates default rules and contact_methods if missing in YAML', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('profile: minimal\n');

    const config = getEventProfile();
    expect(config.profile).toBe('minimal');
    expect(Array.isArray(config.rules)).toBe(true);
    expect(config.contact_methods).toEqual(['Phone', 'Email']);
  });

  it('logs error and re-throws when fs.readFileSync fails', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.EVENT_PROFILE_PATH = 'nonexistent/path/profile.yaml';

    expect(() => getEventProfile()).toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read event profile config at'),
      expect.any(String)
    );
  });

  it('loads rules from separate rules.yaml file', () => {
    // The default lifestyle profile now has a split rules.yaml
    const config = getEventProfile();
    expect(config.rules.length).toBeGreaterThan(0);
    expect(config.rules[0]).toHaveProperty('rule_type');
  });

  it('loads stickers from separate stickers.yaml file', () => {
    const config = getEventProfile();
    expect(config.stickers).toBeDefined();
    expect(typeof config.stickers).toBe('object');
  });

  it('loads demo_seeds from separate demo_seeds.yaml file', () => {
    const config = getEventProfile();
    expect(config.demo_seeds).not.toBeNull();
    expect(Array.isArray(config.demo_seeds.actions)).toBe(true);
    expect(Array.isArray(config.demo_seeds.subjects)).toBe(true);
    expect(Array.isArray(config.demo_seeds.contexts)).toBe(true);
  });

  it('sets demo_seeds to null when demo_seeds.yaml does not exist', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('profile: minimal\n');
    // existsSync returns false for everything except the main profile.yaml path
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const config = getEventProfile();
    expect(config.demo_seeds).toBeNull();
  });

  it('prefers split rules.yaml over inline rules in profile.yaml', async () => {
    const logger = (await import('./logger.js')).default;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const profileDir = path.resolve(process.cwd(), 'profiles', 'lifestyle');

    const originalExistsSync = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => originalExistsSync(p));

    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (p === path.join(profileDir, 'profile.yaml')) {
        // Simulate a monolithic file that also has inline rules
        return 'profile: lifestyle\ncontact_methods:\n  - Phone\nrules:\n  - id: inline_rule\n    rule_type: expansion\n    trigger_attribute: test\n    trigger_value: test\n    target_attribute: test\n    target_value: test\n';
      }
      return originalReadFileSync(p, enc);
    });

    const config = getEventProfile();
    // The split rules.yaml should win — look for its first rule, not the inline one
    expect(config.rules.some((r) => r.id === 'inline_rule')).toBe(false);
    expect(config.rules.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rules.yaml takes precedence'));
  });

  it('validates and applies defaults for branding block', () => {
    const config = getEventProfile();
    expect(config.branding).toBeDefined();
    expect(['midnight', 'daylight', 'corkhouse', 'high-contrast']).toContain(
      config.branding.themePreset
    );
    expect(config.branding.boardTitle).toBeDefined();
    expect(config.branding.accentColor).toBeDefined();

    // Direct validateBranding unit tests covering edge cases & invalid values
    expect(validateBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(validateBranding('invalid')).toEqual(DEFAULT_BRANDING);
    expect(
      validateBranding({
        themePreset: 'neon-glow', // Invalid theme preset
        accentColor: '', // Empty accent color
        boardTitle: '   ', // Whitespace-only title
        tagline: null, // Non-string tagline
      })
    ).toEqual(DEFAULT_BRANDING);

    expect(
      validateBranding({
        themePreset: 'corkhouse',
        accentColor: '#10b981',
        boardTitle: 'Custom Board',
        tagline: 'Custom Tagline',
      })
    ).toEqual({
      themePreset: 'corkhouse',
      accentColor: '#10b981',
      primaryColor: '#10b981',
      surfaceColor: 'rgba(30, 41, 59, 0.78)',
      boardTitle: 'Custom Board',
      tagline: 'Custom Tagline',
      boardTexture: 'cork',
      logoUrl: null,
      boardBgUrl: null,
    });
  });

  describe('getEffectiveEventProfile & DB overrides', () => {
    beforeEach(async () => {
      await clearProfileOverrides();
    });

    it('merges categories, suggestions, and sanitized stickers from DB over YAML base', async () => {
      await setProfileOverride('categories', [
        { id: 'gender', label: 'Gender Identity', suggestions: ['Demi-girl', 'Nonbinary'] },
        { id: 'kink_experience', label: 'Experience', suggestions: ['Newbie', 'Veteran'] },
      ]);
      await setProfileOverride('suggestions', {
        orientation: ['Omni', 'Gay'],
      });
      await setProfileOverride('stickers', {
        role: {
          star: {
            type: 'svg',
            svg: '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><polygon points="12,2 15,9 22,9" fill="#f59e0b" /></svg>',
          },
          unsafe_svg: {
            type: 'svg',
            svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
          },
          unsafe_img: {
            type: 'image',
            src: 'https://evil.example/a.png',
          },
          safe_img: {
            type: 'image',
            src: '/assets/badge.png',
          },
        },
      });

      const effective = await getEffectiveEventProfile();
      const genderCat = effective.categories.find((c) => c.id === 'gender');
      expect(genderCat.label).toBe('Gender Identity');
      expect(genderCat.suggestions).toContain('Demi-girl');
      // Deduplicated
      expect(genderCat.suggestions.filter((s) => s === 'Nonbinary')).toHaveLength(1);

      const expCat = effective.categories.find((c) => c.id === 'kink_experience');
      expect(expCat).toEqual({
        id: 'kink_experience',
        label: 'Experience',
        suggestions: ['Newbie', 'Veteran'],
      });

      const orientationCat = effective.categories.find((c) => c.id === 'orientation');
      expect(orientationCat.suggestions).toContain('Omni');
      expect(orientationCat.suggestions.filter((s) => s === 'Gay')).toHaveLength(1);

      expect(effective.stickers.role.star).toEqual({
        type: 'svg',
        svg: '<svg viewBox="0 0 24 24"><polygon points="12,2 15,9 22,9" fill="#f59e0b" /></svg>',
      });
      expect(effective.stickers.role.unsafe_svg).toBeUndefined();
      expect(effective.stickers.role.unsafe_img).toBeUndefined();
      expect(effective.stickers.role.safe_img).toEqual({
        type: 'image',
        src: '/assets/badge.png',
      });
    });

    it('caches effective profile according to RULES_CACHE_TTL_MS, returns immutable clones, and invalidates on write/delete', async () => {
      process.env.RULES_CACHE_TTL_MS = '60000';
      const prepareSpy = vi.spyOn(db, 'prepare');
      const first = await getEffectiveEventProfile();
      const second = await getEffectiveEventProfile();
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(prepareSpy).toHaveBeenCalledTimes(1);

      // Mutating returned object does not corrupt cached profile
      second.categories.push({ id: 'mutated', label: 'Mutated', suggestions: [] });
      const stillClean = await getEffectiveEventProfile();
      expect(stillClean.categories.some((c) => c.id === 'mutated')).toBe(false);

      // Dynamic change to RULES_CACHE_TTL_MS=0 takes effect immediately
      process.env.RULES_CACHE_TTL_MS = '0';
      await getEffectiveEventProfile();
      expect(prepareSpy).toHaveBeenCalledTimes(2);

      // Empty/invalid/negative RULES_CACHE_TTL_MS falls back to 60s default
      invalidateEffectiveProfileCache();
      process.env.RULES_CACHE_TTL_MS = '   ';
      await getEffectiveEventProfile();
      await getEffectiveEventProfile();
      expect(prepareSpy).toHaveBeenCalledTimes(3);

      process.env.RULES_CACHE_TTL_MS = '-100';
      await getEffectiveEventProfile();
      expect(prepareSpy).toHaveBeenCalledTimes(3);

      await setProfileOverride('suggestions', { role: ['Switcheroo'] });
      const third = await getEffectiveEventProfile();
      expect(third).not.toEqual(first);
      expect(third.categories.find((c) => c.id === 'role')?.suggestions).toContain('Switcheroo');

      await deleteProfileOverride('suggestions');
      const fourth = await getEffectiveEventProfile();
      expect(fourth.categories.find((c) => c.id === 'role')?.suggestions).not.toContain(
        'Switcheroo'
      );
    });

    it('rejects __proto__, constructor, and prototype keys to prevent prototype pollution', async () => {
      const evilStickersJson =
        '{"__proto__":{"polluted":{"type":"heart","class":"x"}},"constructor":{"prototype":{"polluted":true}},"role":{"__proto__":{"type":"heart"},"constructor":{"type":"heart"},"prototype":{"type":"heart"},"valid":{"type":"heart","class":"ok"}}}';
      const evilSuggestionsJson =
        '{"__proto__":["evil"],"constructor":["evil"],"prototype":["evil"]}';
      const evilCategoriesJson =
        '[{"id":"__proto__","label":"Evil"},{"id":"constructor","label":"Evil"},{"id":"prototype","label":"Evil"}]';

      await db
        .prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run('profile_override:stickers', evilStickersJson, new Date().toISOString());
      await db
        .prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run('profile_override:suggestions', evilSuggestionsJson, new Date().toISOString());
      await db
        .prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run('profile_override:categories', evilCategoriesJson, new Date().toISOString());

      invalidateEffectiveProfileCache();
      const effective = await getEffectiveEventProfile();

      expect({}.polluted).toBeUndefined();
      expect(Object.hasOwn(effective.stickers, '__proto__')).toBe(false);
      expect(Object.hasOwn(effective.stickers, 'constructor')).toBe(false);
      expect(Object.hasOwn(effective.stickers, 'prototype')).toBe(false);
      expect(Object.hasOwn(effective.stickers.role, '__proto__')).toBe(false);
      expect(Object.hasOwn(effective.stickers.role, 'constructor')).toBe(false);
      expect(Object.hasOwn(effective.stickers.role, 'prototype')).toBe(false);
      expect(effective.stickers.role.valid).toEqual({ type: 'heart', class: 'ok' });
      expect(effective.categories.some((c) => c.id === '__proto__')).toBe(false);
    });

    it('does not populate cache if invalidated while DB query is in flight', async () => {
      process.env.RULES_CACHE_TTL_MS = '60000';
      invalidateEffectiveProfileCache();

      let resolveAll;
      const pendingAll = new Promise((resolve) => {
        resolveAll = resolve;
      });
      const prepareSpy = vi.spyOn(db, 'prepare').mockImplementationOnce(() => ({
        all: () => pendingAll,
      }));

      const inFlight = getEffectiveEventProfile();
      invalidateEffectiveProfileCache();
      resolveAll([
        {
          key: 'profile_override:suggestions',
          value: JSON.stringify({ role: ['StaleInFlight'] }),
        },
      ]);
      await inFlight;

      // Next call must NOT hit the stale in-flight cache; it must query DB fresh
      const fresh = await getEffectiveEventProfile();
      expect(prepareSpy).toHaveBeenCalledTimes(2);
      expect(fresh.categories.find((c) => c.id === 'role')?.suggestions).not.toContain(
        'StaleInFlight'
      );
    });

    it('falls back cleanly to base YAML if DB query fails or JSON is malformed', async () => {
      await db
        .prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run('profile_override:categories', '{bad-json', new Date().toISOString());
      invalidateEffectiveProfileCache();

      const withBadJson = await getEffectiveEventProfile();
      expect(withBadJson.profile).toBe(getEventProfile().profile);

      invalidateEffectiveProfileCache();
      vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
        throw new Error('DB unavailable');
      });
      const withDbErr = await getEffectiveEventProfile();
      expect(withDbErr.profile).toBe(getEventProfile().profile);
    });

    it('rejects invalid override section names', async () => {
      await expect(setProfileOverride('invalid_section', {})).rejects.toThrow(
        'Invalid profile override section'
      );
      await expect(deleteProfileOverride('invalid_section')).rejects.toThrow(
        'Invalid profile override section'
      );
    });
  });
});
