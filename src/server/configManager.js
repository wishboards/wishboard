import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import logger from './logger.js';
import { sanitizeStickerImageSrc, sanitizeSvg } from '../shared/svgSanitizer.js';

export const DEFAULT_EVENT_PROFILE = 'lifestyle';

export const DEFAULT_BRANDING = {
  themePreset: 'midnight',
  accentColor: '#f59e0b',
  primaryColor: '#f59e0b',
  surfaceColor: 'rgba(30, 41, 59, 0.78)',
  boardTitle: 'Wishboard',
  tagline: 'Pin your convention wishes',
  boardTexture: 'cork',
  logoUrl: null,
  boardBgUrl: null,
};

const VALID_THEME_PRESETS = new Set([
  'midnight',
  'daylight',
  'corkhouse',
  'high-contrast',
  'custom',
]);
const VALID_BOARD_TEXTURES = new Set(['cork', 'slate', 'linen', 'custom', 'none']);

const nonEmptyTrimmed = (val, fallback) =>
  typeof val === 'string' && val.trim() ? val.trim() : fallback;

export const validateBranding = (rawBranding) => {
  if (!rawBranding || typeof rawBranding !== 'object') {
    return { ...DEFAULT_BRANDING };
  }
  const themePreset = VALID_THEME_PRESETS.has(rawBranding.themePreset)
    ? rawBranding.themePreset
    : DEFAULT_BRANDING.themePreset;
  const accentColor = nonEmptyTrimmed(rawBranding.accentColor, DEFAULT_BRANDING.accentColor);
  const primaryColor = nonEmptyTrimmed(
    rawBranding.primaryColor,
    accentColor || DEFAULT_BRANDING.primaryColor
  );
  const surfaceColor = nonEmptyTrimmed(rawBranding.surfaceColor, DEFAULT_BRANDING.surfaceColor);
  const boardTitle = nonEmptyTrimmed(rawBranding.boardTitle, DEFAULT_BRANDING.boardTitle);
  const tagline = nonEmptyTrimmed(rawBranding.tagline, DEFAULT_BRANDING.tagline);
  const boardTexture = VALID_BOARD_TEXTURES.has(rawBranding.boardTexture)
    ? rawBranding.boardTexture
    : DEFAULT_BRANDING.boardTexture;
  const logoUrl = nonEmptyTrimmed(rawBranding.logoUrl, null);
  const boardBgUrl = nonEmptyTrimmed(rawBranding.boardBgUrl, null);

  return {
    themePreset,
    accentColor,
    primaryColor,
    surfaceColor,
    boardTitle,
    tagline,
    boardTexture,
    logoUrl,
    boardBgUrl,
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedConfig = null;

/**
 * Load and parse a YAML file, returning null if it doesn't exist.
 * @param {string} filePath - Absolute path to the YAML file
 * @returns {object|null}
 */
const loadOptionalYaml = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logger.warn(`Could not parse YAML file ${filePath}: ${err.message}`);
    return null;
  }
};

/**
 * Resolve the profile directory from environment variables.
 * Returns { profileDir, configPath } where configPath is the main profile.yaml.
 */
const resolveProfileDir = () => {
  let configPath = process.env.EVENT_PROFILE_PATH;

  if (configPath) {
    // Explicit path — resolve relative to cwd, derive directory from it
    configPath = path.resolve(process.cwd(), configPath);
    return { profileDir: path.dirname(configPath), configPath };
  }

  const profileName = process.env.EVENT_PROFILE || DEFAULT_EVENT_PROFILE;
  const repoDir = path.resolve(process.cwd(), 'profiles', profileName);
  const repoPath = path.join(repoDir, 'profile.yaml');
  const bundledPath = path.resolve(__dirname, 'profile.yaml');

  if (fs.existsSync(repoPath)) {
    return { profileDir: repoDir, configPath: repoPath };
  } else if (fs.existsSync(bundledPath)) {
    return { profileDir: __dirname, configPath: bundledPath };
  }

  // Fallback for error reporting
  return { profileDir: repoDir, configPath: repoPath };
};

const mergeSplitYamlFiles = (config, profileDir) => {
  const rulesFile = loadOptionalYaml(path.join(profileDir, 'rules.yaml'));
  if (rulesFile?.rules) {
    if (config.rules && config.rules.length > 0) {
      logger.warn(
        'Profile has rules in both profile.yaml and rules.yaml — rules.yaml takes precedence'
      );
    }
    config.rules = rulesFile.rules;
  }

  const stickersFile = loadOptionalYaml(path.join(profileDir, 'stickers.yaml'));
  if (stickersFile?.stickers) {
    if (config.stickers && Object.keys(config.stickers).length > 0) {
      logger.warn(
        'Profile has stickers in both profile.yaml and stickers.yaml — stickers.yaml takes precedence'
      );
    }
    config.stickers = stickersFile.stickers;
  }

  const demoSeedsFile = loadOptionalYaml(path.join(profileDir, 'demo_seeds.yaml'));
  if (demoSeedsFile) {
    if (config.demo_seeds) {
      logger.warn(
        'Profile has demo_seeds in both profile.yaml and demo_seeds.yaml — demo_seeds.yaml takes precedence'
      );
    }
    config.demo_seeds = demoSeedsFile;
  } else if (!config.demo_seeds) {
    config.demo_seeds = null;
  }
};

export const getEventProfile = () => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const { profileDir, configPath } = resolveProfileDir();

  let fileContents;
  try {
    fileContents = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    console.error(`Failed to read event profile config at ${configPath}:`, err.message);
    throw err;
  }

  const config = yaml.parse(fileContents);

  mergeSplitYamlFiles(config, profileDir);

  // --- Defaults for missing optional keys ---
  if (!config.rules) {
    config.rules = [];
  }

  if (!config.contact_methods) {
    config.contact_methods = ['Phone', 'Email'];
  }

  config.branding = validateBranding(config.branding);

  cachedConfig = config;
  return config;
};

export const getDomainConfig = getEventProfile;

let cachedEffectiveProfile = null;
let effectiveProfileLoadedAt = 0;
let effectiveProfileGeneration = 0;

const PROFILE_OVERRIDE_SECTIONS = new Set(['categories', 'suggestions', 'stickers']);
const DISALLOWED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const getRulesCacheTtlMs = () => {
  const raw = (process.env.RULES_CACHE_TTL_MS ?? '').trim();
  if (!raw) return 60_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60_000;
};

const dedupeStrings = (items) => {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const cloneStickerMap = (map) => {
  const cloned = {};
  if (!map || typeof map !== 'object') return cloned;
  for (const k of Object.keys(map)) {
    if (DISALLOWED_OBJECT_KEYS.has(k) || !Object.hasOwn(map, k)) continue;
    const v = map[k];
    cloned[k] = v && typeof v === 'object' ? { ...v } : v;
  }
  return cloned;
};

const cloneStickers = (baseStickers) => {
  const stickers = {};
  if (!baseStickers || typeof baseStickers !== 'object') return stickers;
  for (const cat of Object.keys(baseStickers)) {
    if (DISALLOWED_OBJECT_KEYS.has(cat) || !Object.hasOwn(baseStickers, cat)) continue;
    stickers[cat] = cloneStickerMap(baseStickers[cat]);
  }
  return stickers;
};

const cloneBaseProfile = (base) => ({
  ...base,
  categories: Array.isArray(base.categories)
    ? base.categories.map((cat) => ({
        ...cat,
        suggestions: Array.isArray(cat.suggestions) ? [...cat.suggestions] : [],
      }))
    : [],
  stickers: cloneStickers(base.stickers),
});

const getNonEmptyOwnString = (obj, key) => {
  if (!Object.hasOwn(obj, key) || typeof obj[key] !== 'string') return null;
  const trimmed = obj[key].trim();
  return trimmed || null;
};

const applyCategoryUpdate = (existing, cat) => {
  const label = getNonEmptyOwnString(cat, 'label');
  if (label) existing.label = label;
  const type = getNonEmptyOwnString(cat, 'type');
  if (type) existing.type = type;
  if (Object.hasOwn(cat, 'suggestions') && Array.isArray(cat.suggestions)) {
    existing.suggestions = dedupeStrings([...(existing.suggestions || []), ...cat.suggestions]);
  }
};

const buildNewCategory = (id, cat) => {
  const label = getNonEmptyOwnString(cat, 'label') ?? id;
  const type = getNonEmptyOwnString(cat, 'type');
  const rawSuggestions = Object.hasOwn(cat, 'suggestions') ? cat.suggestions || [] : [];
  return {
    id,
    label,
    ...(type ? { type } : {}),
    suggestions: dedupeStrings(rawSuggestions),
  };
};

const mergeCategoryOverrides = (merged, overrideCategories) => {
  for (const cat of overrideCategories) {
    if (!cat || typeof cat !== 'object' || typeof cat.id !== 'string' || !cat.id.trim()) {
      continue;
    }
    const id = cat.id.trim();
    if (DISALLOWED_OBJECT_KEYS.has(id)) continue;
    const existing = merged.categories.find((c) => c.id === id);
    if (existing) {
      applyCategoryUpdate(existing, cat);
    } else {
      merged.categories.push(buildNewCategory(id, cat));
    }
  }
};

const mergeSuggestionOverrides = (merged, overrideSuggestions) => {
  for (const catId of Object.keys(overrideSuggestions)) {
    if (DISALLOWED_OBJECT_KEYS.has(catId) || !Object.hasOwn(overrideSuggestions, catId)) {
      continue;
    }
    const suggestions = overrideSuggestions[catId];
    if (!Array.isArray(suggestions)) continue;
    const existing = merged.categories.find((c) => c.id === catId);
    if (existing) {
      existing.suggestions = dedupeStrings([...(existing.suggestions || []), ...suggestions]);
    }
  }
};

const sanitizeStickerOverrideRule = (rule) => {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return null;
  }
  if (rule.type === 'svg') {
    const sanitized = typeof rule.svg === 'string' ? sanitizeSvg(rule.svg) : null;
    if (!sanitized) return null;
    return { ...rule, type: 'svg', svg: sanitized };
  }
  if (rule.type === 'image') {
    const safeSrc = typeof rule.src === 'string' ? sanitizeStickerImageSrc(rule.src) : null;
    if (!safeSrc) return null;
    return { ...rule, type: 'image', src: safeSrc };
  }
  return { ...rule };
};

const mergeStickerOverrides = (merged, overrideStickers) => {
  for (const cat of Object.keys(overrideStickers)) {
    if (DISALLOWED_OBJECT_KEYS.has(cat) || !Object.hasOwn(overrideStickers, cat)) {
      continue;
    }
    const stickerMap = overrideStickers[cat];
    if (!stickerMap || typeof stickerMap !== 'object' || Array.isArray(stickerMap)) {
      continue;
    }
    if (
      !Object.hasOwn(merged.stickers, cat) ||
      !merged.stickers[cat] ||
      typeof merged.stickers[cat] !== 'object'
    ) {
      merged.stickers[cat] = {};
    }
    for (const term of Object.keys(stickerMap)) {
      if (DISALLOWED_OBJECT_KEYS.has(term) || !Object.hasOwn(stickerMap, term)) {
        continue;
      }
      const sanitizedRule = sanitizeStickerOverrideRule(stickerMap[term]);
      if (sanitizedRule) {
        merged.stickers[cat][term] = sanitizedRule;
      }
    }
  }
};

export const invalidateEffectiveProfileCache = () => {
  effectiveProfileGeneration += 1;
  cachedEffectiveProfile = null;
  effectiveProfileLoadedAt = 0;
};

/**
 * Retrieve the effective event profile by merging DB overrides (`settings` keys
 * matching `profile_override:%`) on top of the base YAML profile.
 * Uses an in-memory TTL cache controlled by `RULES_CACHE_TTL_MS` (default 60s).
 *
 * @returns {Promise<object>}
 */
const parseProfileOverrideRows = (rows) => {
  const overrides = {};
  for (const row of rows) {
    if (!row?.key || !row?.value) continue;
    try {
      overrides[row.key] = JSON.parse(row.value);
    } catch (parseErr) {
      logger.warn(`Ignoring invalid JSON in ${row.key}: ${parseErr.message}`);
    }
  }
  return overrides;
};

const isPlainRecord = (val) => Boolean(val) && typeof val === 'object' && !Array.isArray(val);

const applyProfileOverrides = (merged, overrides) => {
  if (Array.isArray(overrides['profile_override:categories'])) {
    mergeCategoryOverrides(merged, overrides['profile_override:categories']);
  }
  if (isPlainRecord(overrides['profile_override:suggestions'])) {
    mergeSuggestionOverrides(merged, overrides['profile_override:suggestions']);
  }
  if (isPlainRecord(overrides['profile_override:stickers'])) {
    mergeStickerOverrides(merged, overrides['profile_override:stickers']);
  }
};

export const getEffectiveEventProfile = async () => {
  const ttlMs = getRulesCacheTtlMs();
  if (ttlMs > 0 && cachedEffectiveProfile && Date.now() - effectiveProfileLoadedAt < ttlMs) {
    return structuredClone(cachedEffectiveProfile);
  }

  const gen = effectiveProfileGeneration;
  const base = getEventProfile();
  const merged = cloneBaseProfile(base);

  try {
    const { default: db } = await import('./db.js');
    const rows = await db
      .prepare('SELECT key, value FROM settings WHERE key LIKE ?')
      .all('profile_override:%');

    if (Array.isArray(rows) && rows.length > 0) {
      applyProfileOverrides(merged, parseProfileOverrideRows(rows));
    }
  } catch (err) {
    logger.warn(`Could not read profile overrides from database, using YAML base: ${err.message}`);
    return cloneBaseProfile(base);
  }

  if (ttlMs > 0 && gen === effectiveProfileGeneration) {
    cachedEffectiveProfile = merged;
    effectiveProfileLoadedAt = Date.now();
  }

  return structuredClone(merged);
};

/**
 * Persist a profile override section (`categories`, `suggestions`, or `stickers`)
 * to the `settings` table and invalidate the effective profile cache.
 *
 * @param {'categories' | 'suggestions' | 'stickers'} section
 * @param {unknown} value
 */
export const setProfileOverride = async (section, value) => {
  if (!PROFILE_OVERRIDE_SECTIONS.has(section)) {
    throw new Error(`Invalid profile override section: ${section}`);
  }
  const { default: db } = await import('./db.js');
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    .run(`profile_override:${section}`, JSON.stringify(value), now);
  invalidateEffectiveProfileCache();
};

/**
 * Delete a single profile override section (`categories`, `suggestions`, or `stickers`)
 * from the `settings` table and invalidate the effective profile cache.
 *
 * @param {'categories' | 'suggestions' | 'stickers'} section
 */
export const deleteProfileOverride = async (section) => {
  if (!PROFILE_OVERRIDE_SECTIONS.has(section)) {
    throw new Error(`Invalid profile override section: ${section}`);
  }
  const { default: db } = await import('./db.js');
  await db.prepare('DELETE FROM settings WHERE key = ?').run(`profile_override:${section}`);
  invalidateEffectiveProfileCache();
};

/**
 * Clear all `profile_override:%` entries from the `settings` table
 * and invalidate the effective profile cache.
 */
export const clearProfileOverrides = async () => {
  const { default: db } = await import('./db.js');
  await db.prepare('DELETE FROM settings WHERE key LIKE ?').run('profile_override:%');
  invalidateEffectiveProfileCache();
};

export const clearConfigCache = () => {
  cachedConfig = null;
  invalidateEffectiveProfileCache();
};
