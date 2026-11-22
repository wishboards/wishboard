import db from './db.js';
import { getEventProfile, validateBranding } from './configManager.js';

const BRANDING_NULLABLE_KEY_MAP = {
  'branding:logo_url': 'logoUrl',
  'branding:board_bg_url': 'boardBgUrl',
  'branding:board_texture': 'boardTexture',
  'branding:board_title': 'boardTitle',
  'branding:tagline': 'tagline',
};

const BRANDING_STRING_UPDATES = [
  ['boardTexture', 'branding:board_texture'],
  ['boardTitle', 'branding:board_title'],
  ['tagline', 'branding:tagline'],
];

function toTrimmedString(val) {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  return '';
}

function applyBrandingColors(rawValue, overrides) {
  try {
    const colors = JSON.parse(rawValue);
    if (!colors || typeof colors !== 'object') return;
    if (colors.primary) overrides.primaryColor = colors.primary;
    if (colors.accent) overrides.accentColor = colors.accent;
    if (colors.surface) overrides.surfaceColor = colors.surface;
  } catch {
    // Ignore invalid JSON colors in DB
  }
}

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
        applyBrandingColors(row.value, overrides);
      } else if (row.key in BRANDING_NULLABLE_KEY_MAP) {
        overrides[BRANDING_NULLABLE_KEY_MAP[row.key]] = row.value || null;
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

async function persistBrandingColors(updates, upsertSetting) {
  if (
    updates.primaryColor === undefined &&
    updates.accentColor === undefined &&
    updates.surfaceColor === undefined
  ) {
    return;
  }

  let existingColors = {};
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get('branding:colors');
    if (row?.value) {
      existingColors = JSON.parse(row.value);
    }
  } catch {
    existingColors = {};
  }

  const mergedColors = {
    ...existingColors,
    ...(updates.primaryColor !== undefined
      ? { primary: toTrimmedString(updates.primaryColor) }
      : {}),
    ...(updates.accentColor !== undefined ? { accent: toTrimmedString(updates.accentColor) } : {}),
    ...(updates.surfaceColor !== undefined
      ? { surface: toTrimmedString(updates.surfaceColor) }
      : {}),
  };
  await upsertSetting('branding:colors', JSON.stringify(mergedColors));
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

  await persistBrandingColors(updates, upsertSetting);

  if (updates.logoUrl !== undefined) {
    await upsertSetting(
      'branding:logo_url',
      updates.logoUrl ? toTrimmedString(updates.logoUrl) : ''
    );
  }

  if (updates.boardBgUrl !== undefined) {
    await upsertSetting(
      'branding:board_bg_url',
      updates.boardBgUrl ? toTrimmedString(updates.boardBgUrl) : ''
    );
  }

  for (const [field, settingKey] of BRANDING_STRING_UPDATES) {
    if (typeof updates[field] === 'string') {
      await upsertSetting(settingKey, updates[field].trim());
    }
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
