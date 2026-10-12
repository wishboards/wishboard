import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEventProfile, getDomainConfig, clearConfigCache } from './configManager.js';

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
});
