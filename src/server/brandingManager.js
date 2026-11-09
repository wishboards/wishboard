import db from './db.js';
import { getEventProfile, validateBranding } from './configManager.js';

/**
 * Retrieve the active branding configuration, merging the event profile defaults
 * with any host overrides persisted in the `settings` database table.
 *
 * @returns {Promise<import('./configManager.js').BrandingConfig>}
 */
export async function getMergedBranding() {
  const profile = getEventProfile();
  const baseBranding = { ...profile.branding };

  try {
    const rows = await db
      .prepare('SELECT key, value FROM settings WHERE key LIKE ?')
      .all('branding:%');

    if (!rows || rows.length === 0) {
      return validateBranding(baseBranding);
    }

    const overrides = {};
    for (const row of rows) {
      if (row.key === 'branding:preset' && row.value) {
        overrides.themePreset = row.value;
      } else if (row.key === 'branding:colors' && row.value) {
        try {
          const colors = JSON.parse(row.value);
          if (colors && typeof colors === 'object') {
            if (colors.primary) overrides.primaryColor = colors.primary;
            if (colors.accent) overrides.accentColor = colors.accent;
            if (colors.surface) overrides.surfaceColor = colors.surface;
          }
        } catch {
          // Ignore invalid JSON colors in DB
        }
      } else if (row.key === 'branding:logo_url') {
        overrides.logoUrl = row.value || null;
      } else if (row.key === 'branding:board_bg_url') {
        overrides.boardBgUrl = row.value || null;
      } else if (row.key === 'branding:board_texture') {
        overrides.boardTexture = row.value || null;
      } else if (row.key === 'branding:board_title') {
        overrides.boardTitle = row.value || null;
      } else if (row.key === 'branding:tagline') {
        overrides.tagline = row.value || null;
      }
    }

    return validateBranding({
      ...baseBranding,
      ...overrides,
    });
  } catch (err) {
    console.warn(
      'Could not read branding settings from database, using profile defaults:',
      err.message
    );
    return validateBranding(baseBranding);
  }
}

/**
 * Persist host branding overrides into the `settings` table.
 *
 * @param {Record<string, unknown>} updates
 * @returns {Promise<import('./configManager.js').BrandingConfig>}
 */
export async function updateBranding(updates) {
  if (!updates || typeof updates !== 'object') {
    return getMergedBranding();
  }

  const now = new Date().toISOString();
  const upsertSetting = async (key, value) => {
    await db
      .prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      )
      .run(key, value, now);
  };

  if (typeof updates.themePreset === 'string' && updates.themePreset.trim()) {
    await upsertSetting('branding:preset', updates.themePreset.trim());
  }

  // Handle color updates: read existing or create fresh
  if (
    updates.primaryColor !== undefined ||
    updates.accentColor !== undefined ||
    updates.surfaceColor !== undefined
  ) {
    let existingColors = {};
    try {
      const row = await db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('branding:colors');
      if (row?.value) {
        existingColors = JSON.parse(row.value);
      }
    } catch {
      existingColors = {};
    }

    const mergedColors = {
      ...existingColors,
      ...(updates.primaryColor !== undefined
        ? { primary: String(updates.primaryColor).trim() }
        : {}),
      ...(updates.accentColor !== undefined ? { accent: String(updates.accentColor).trim() } : {}),
      ...(updates.surfaceColor !== undefined
        ? { surface: String(updates.surfaceColor).trim() }
        : {}),
    };
    await upsertSetting('branding:colors', JSON.stringify(mergedColors));
  }

  if (updates.logoUrl !== undefined) {
    await upsertSetting('branding:logo_url', updates.logoUrl ? String(updates.logoUrl).trim() : '');
  }

  if (updates.boardBgUrl !== undefined) {
    await upsertSetting(
      'branding:board_bg_url',
      updates.boardBgUrl ? String(updates.boardBgUrl).trim() : ''
    );
  }

  if (typeof updates.boardTexture === 'string') {
    await upsertSetting('branding:board_texture', updates.boardTexture.trim());
  }

  if (typeof updates.boardTitle === 'string') {
    await upsertSetting('branding:board_title', updates.boardTitle.trim());
  }

  if (typeof updates.tagline === 'string') {
    await upsertSetting('branding:tagline', updates.tagline.trim());
  }

  return getMergedBranding();
}

/**
 * Reset all host branding overrides back to the event profile defaults.
 *
 * @returns {Promise<import('./configManager.js').BrandingConfig>}
 */
export async function resetBranding() {
  await db.prepare('DELETE FROM settings WHERE key LIKE ?').run('branding:%');
  return getMergedBranding();
}
