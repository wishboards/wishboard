import { describe, it, expect, beforeEach } from 'vitest';
import db from './db.js';
import { getMergedBranding, updateBranding, resetBranding } from './brandingManager.js';
import { getEventProfile, DEFAULT_BRANDING } from './configManager.js';

describe('brandingManager', () => {
  beforeEach(async () => {
    // Clear all settings in test database
    await db.prepare('DELETE FROM settings WHERE key LIKE ?').run('branding:%');
  });

  it('returns default event profile branding when settings table is empty', async () => {
    const branding = await getMergedBranding();
    const profileBranding = getEventProfile().branding;
    expect(branding.themePreset).toBe(profileBranding.themePreset);
    expect(branding.accentColor).toBe(profileBranding.accentColor);
    expect(branding.boardTitle).toBe(profileBranding.boardTitle);
    expect(branding.boardTexture).toBe(profileBranding.boardTexture || 'cork');
    expect(branding.logoUrl).toBeNull();
    expect(branding.boardBgUrl).toBeNull();
  });

  it('updates branding settings and returns merged result', async () => {
    const updated = await updateBranding({
      themePreset: 'corkhouse',
      accentColor: '#3b82f6',
      primaryColor: '#1d4ed8',
      surfaceColor: 'rgba(15, 23, 42, 0.9)',
      boardTitle: 'Anime Expo Wishboard',
      tagline: 'Connect with fellow cosplayers',
      boardTexture: 'linen',
      logoUrl: '/images/branding-logo.webp',
      boardBgUrl: '/images/branding-bg.webp',
    });

    expect(updated.themePreset).toBe('corkhouse');
    expect(updated.accentColor).toBe('#3b82f6');
    expect(updated.primaryColor).toBe('#1d4ed8');
    expect(updated.surfaceColor).toBe('rgba(15, 23, 42, 0.9)');
    expect(updated.boardTitle).toBe('Anime Expo Wishboard');
    expect(updated.tagline).toBe('Connect with fellow cosplayers');
    expect(updated.boardTexture).toBe('linen');
    expect(updated.logoUrl).toBe('/images/branding-logo.webp');
    expect(updated.boardBgUrl).toBe('/images/branding-bg.webp');

    // Confirm it is persisted upon subsequent fetch
    const fetched = await getMergedBranding();
    expect(fetched).toEqual(updated);
  });

  it('updates individual fields while preserving existing values', async () => {
    await updateBranding({
      themePreset: 'daylight',
      accentColor: '#10b981',
      boardTitle: 'Gaming Con',
    });

    const step2 = await updateBranding({
      tagline: 'Find your party',
      boardTexture: 'slate',
    });

    expect(step2.themePreset).toBe('daylight');
    expect(step2.accentColor).toBe('#10b981');
    expect(step2.boardTitle).toBe('Gaming Con');
    expect(step2.tagline).toBe('Find your party');
    expect(step2.boardTexture).toBe('slate');
  });

  it('gracefully handles corrupt json in branding:colors', async () => {
    await db
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('branding:colors', 'invalid-json-{', new Date().toISOString());

    const branding = await getMergedBranding();
    expect(branding).toBeDefined();
    expect(branding.accentColor).toBeDefined();
  });

  it('resets branding overrides back to event profile defaults', async () => {
    await updateBranding({
      themePreset: 'high-contrast',
      accentColor: '#00ff00',
      boardTitle: 'Overridden Board',
      logoUrl: '/images/logo.png',
    });

    const reset = await resetBranding();
    const profileBranding = getEventProfile().branding;

    expect(reset.themePreset).toBe(profileBranding.themePreset);
    expect(reset.accentColor).toBe(profileBranding.accentColor);
    expect(reset.boardTitle).toBe(profileBranding.boardTitle);
    expect(reset.logoUrl).toBeNull();

    const inDb = await db
      .prepare('SELECT count(*) as count FROM settings WHERE key LIKE ?')
      .get('branding:%');
    expect(Number(inDb.count)).toBe(0);
  });

  it('handles null and empty updates safely', async () => {
    const brandingBefore = await getMergedBranding();
    const result1 = await updateBranding(null);
    const result2 = await updateBranding(undefined);
    expect(result1).toEqual(brandingBefore);
    expect(result2).toEqual(brandingBefore);
  });
});
