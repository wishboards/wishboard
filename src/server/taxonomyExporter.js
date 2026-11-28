import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { validateRuleset } from '@wishboards/matching-engine';
import db from './db.js';
import { getEventProfile, getEffectiveEventProfile } from './configManager.js';
import { getRules } from './rulesManager.js';
import { sanitizeSvg, sanitizeStickerImageSrc } from '../shared/svgSanitizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const DISALLOWED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sortObjectKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted = {};
  for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    if (DISALLOWED_OBJECT_KEYS.has(key) || !Object.hasOwn(obj, key)) continue;
    const val = obj[key];
    sorted[key] = val && typeof val === 'object' && !Array.isArray(val) ? sortObjectKeys(val) : val;
  }
  return sorted;
}

function deterministicYaml(doc) {
  return yaml.stringify(doc, { sortMapEntries: true });
}

async function readDbOverrideSection(section, fallback) {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`profile_override:${section}`);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function readBundledSvgFile(src, repoRoot = REPO_ROOT) {
  const cleanSrc = sanitizeStickerImageSrc(src);
  if (!cleanSrc || !cleanSrc.startsWith('/assets/stickers/')) return null;
  const filename = path.basename(cleanSrc);
  const candidates = [
    path.join(repoRoot, 'profiles', 'lifestyle', 'assets', 'stickers', filename),
    path.join(repoRoot, 'src', 'client', 'public', 'assets', 'stickers', filename),
    path.join(repoRoot, 'public', 'assets', 'stickers', filename),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const clean = sanitizeSvg(raw);
      if (clean) return clean;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function sanitizeAssetPathSegment(segment) {
  return (
    String(segment ?? '')
      .replaceAll(/[/\\]+/g, '_')
      .replaceAll(/\.\.+/g, '_')
      .replaceAll(/[^a-zA-Z0-9 ._-]/g, '_')
      .replaceAll(/^_+|_+$/g, '')
      .trim() || 'unnamed'
  );
}

function collectSanitizedStickerAssets(stickersMap, repoRoot = REPO_ROOT) {
  const rawAssets = {};
  const cleanStickers = {};

  if (!stickersMap || typeof stickersMap !== 'object' || Array.isArray(stickersMap)) {
    return { cleanStickers, assets: rawAssets };
  }

  for (const cat of Object.keys(stickersMap).sort((a, b) => a.localeCompare(b))) {
    if (DISALLOWED_OBJECT_KEYS.has(cat) || !Object.hasOwn(stickersMap, cat)) continue;
    const catMap = stickersMap[cat];
    if (!catMap || typeof catMap !== 'object' || Array.isArray(catMap)) continue;
    cleanStickers[cat] = {};
    const safeCat = sanitizeAssetPathSegment(cat);

    for (const term of Object.keys(catMap).sort((a, b) => a.localeCompare(b))) {
      if (DISALLOWED_OBJECT_KEYS.has(term) || !Object.hasOwn(catMap, term)) continue;
      const rule = catMap[term];
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;

      if (rule.type === 'svg' && typeof rule.svg === 'string') {
        const cleanSvg = sanitizeSvg(rule.svg);
        if (!cleanSvg) continue;
        cleanStickers[cat][term] = { ...rule, type: 'svg', svg: cleanSvg };
        const safeTerm = sanitizeAssetPathSegment(term);
        rawAssets[`stickers/${safeCat}/${safeTerm}.svg`] = cleanSvg;
      } else if (rule.type === 'image' && typeof rule.src === 'string') {
        const cleanSrc = sanitizeStickerImageSrc(rule.src);
        if (!cleanSrc) continue;
        cleanStickers[cat][term] = { ...rule, type: 'image', src: cleanSrc };
        const fileSvg = readBundledSvgFile(cleanSrc, repoRoot);
        if (fileSvg) {
          rawAssets[cleanSrc] = fileSvg;
        }
      } else {
        cleanStickers[cat][term] = { ...rule };
      }
    }
  }

  return {
    cleanStickers,
    assets: sortObjectKeys(rawAssets),
  };
}

function sortRulesDeterministically(rules) {
  return [...(Array.isArray(rules) ? rules : [])]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

/**
 * Exports approved DB overrides (or full effective profile) as a deterministic,
 * `validateRuleset`-verified YAML + SVG patch bundle.
 * Strictly never reads `taxonomy_proposals`, `wishes`, `users`, or PII.
 *
 * @param {{ overridesOnly?: boolean, repoRoot?: string }} [options]
 */
export async function exportTaxonomyBundle({ overridesOnly = false, repoRoot = REPO_ROOT } = {}) {
  const baseProfile = getEventProfile();
  const activeRules = sortRulesDeterministically(getRules());

  let categories;
  let rawStickers;
  let exportedRules;

  if (overridesOnly) {
    const baseRuleSignatures = new Set(
      (Array.isArray(baseProfile.rules) ? baseProfile.rules : []).map((r) =>
        JSON.stringify({
          id: r.id,
          rule_type: r.rule_type,
          trigger_attribute: r.trigger_attribute,
          trigger_value: r.trigger_value,
          context_attribute: r.context_attribute ?? null,
          context_value: r.context_value ?? null,
          target_attribute: r.target_attribute,
          target_value: r.target_value,
        })
      )
    );
    exportedRules = activeRules.filter(
      (r) =>
        !baseRuleSignatures.has(
          JSON.stringify({
            id: r.id,
            rule_type: r.rule_type,
            trigger_attribute: r.trigger_attribute,
            trigger_value: r.trigger_value,
            context_attribute: r.context_attribute ?? null,
            context_value: r.context_value ?? null,
            target_attribute: r.target_attribute,
            target_value: r.target_value,
          })
        )
    );

    const overrideCategories = await readDbOverrideSection('categories', []);
    const overrideSuggestions = await readDbOverrideSection('suggestions', {});
    const overrideStickers = await readDbOverrideSection('stickers', {});

    categories = Array.isArray(overrideCategories) ? overrideCategories : [];
    if (
      overrideSuggestions &&
      typeof overrideSuggestions === 'object' &&
      !Array.isArray(overrideSuggestions)
    ) {
      for (const [catId, terms] of Object.entries(overrideSuggestions)) {
        if (!Array.isArray(terms) || DISALLOWED_OBJECT_KEYS.has(catId)) continue;
        const existing = categories.find((c) => c && c.id === catId);
        if (existing) {
          const merged = new Set([...(existing.suggestions || []), ...terms]);
          existing.suggestions = [...merged];
        } else {
          categories.push({ id: catId, suggestions: [...terms] });
        }
      }
    }
    rawStickers = overrideStickers;
  } else {
    const effective = await getEffectiveEventProfile();
    categories = Array.isArray(effective.categories) ? effective.categories : [];
    rawStickers = effective.stickers || {};
    exportedRules = activeRules;
  }

  const validation = validateRuleset(exportedRules);
  const { cleanStickers, assets } = collectSanitizedStickerAssets(rawStickers, repoRoot);

  const profileDoc = overridesOnly
    ? { categories }
    : {
        ...(baseProfile.name ? { name: baseProfile.name } : {}),
        ...(baseProfile.display_name ? { display_name: baseProfile.display_name } : {}),
        categories,
      };
  const rulesDoc = { rules: exportedRules };
  const stickersDoc = { stickers: cleanStickers };
  const combinedDoc = {
    categories,
    rules: exportedRules,
    stickers: cleanStickers,
  };

  return {
    overridesOnly: Boolean(overridesOnly),
    profileYaml: deterministicYaml(profileDoc),
    rulesYaml: deterministicYaml(rulesDoc),
    stickersYaml: deterministicYaml(stickersDoc),
    yaml: deterministicYaml(combinedDoc),
    categories,
    stickers: cleanStickers,
    assets,
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    },
  };
}
