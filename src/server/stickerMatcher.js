import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { sanitizeSvg, sanitizeStickerImageSrc } from '../shared/svgSanitizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const GEOMETRIC_PALETTES = [
  ['#6366f1', '#ec4899', '#f59e0b'],
  ['#10b981', '#06b6d4', '#3b82f6'],
  ['#8b5cf6', '#d946ef', '#f43f5e'],
  ['#f97316', '#eab308', '#14b8a6'],
  ['#0ea5e9', '#6366f1', '#a855f7'],
  ['#14b8a6', '#84cc16', '#f59e0b'],
];

const PRIDE_SVG_NAMES = new Set([
  'agender',
  'aromantic',
  'bigender',
  'demiromantic',
  'demisexual',
  'genderfluid',
  'graysexual',
  'nonbinary',
  'polyamory',
]);

function normalizeSlug(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_]+/g, '-')
    .replaceAll(/[^a-z0-9-]/g, '')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function loadAllowedBundledLicenses(repoRoot = REPO_ROOT) {
  const provenancePath = path.join(repoRoot, 'profiles', 'provenance.json');
  try {
    const raw = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    const allowed = Array.isArray(raw?.allowedLicenses) ? raw.allowedLicenses : ['CC0-1.0', 'MIT'];
    return new Set(allowed.filter((lic) => lic === 'CC0-1.0' || lic === 'MIT'));
  } catch {
    return new Set(['CC0-1.0', 'MIT']);
  }
}

/**
 * Loads bundled CC0-1.0 / MIT sticker SVG entries from profile and public asset directories
 * and `profiles/lifestyle/stickers.yaml`.
 *
 * @param {string} [repoRoot]
 * @returns {Map<string, { src: string, license: 'CC0-1.0' | 'MIT' }>}
 */
function scanAssetDirectories(catalog, repoRoot, defaultPrideLicense, defaultOtherLicense) {
  const assetDirs = [
    path.join(repoRoot, 'profiles', 'lifestyle', 'assets', 'stickers'),
    path.join(repoRoot, 'public', 'assets', 'stickers'),
    path.join(repoRoot, 'src', 'client', 'public', 'assets', 'stickers'),
  ];

  for (const dir of assetDirs) {
    if (!fs.existsSync(dir)) continue;
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.svg')) continue;
      const slug = normalizeSlug(file.slice(0, -4));
      const src = slug ? sanitizeStickerImageSrc(`/assets/stickers/${file}`) : null;
      if (!src || catalog.has(slug)) continue;
      const license = PRIDE_SVG_NAMES.has(slug) ? defaultPrideLicense : defaultOtherLicense;
      catalog.set(slug, { src, license });
    }
  }
}

function scanStickersYaml(catalog, repoRoot, defaultPrideLicense, defaultOtherLicense) {
  const stickersYamlPath = path.join(repoRoot, 'profiles', 'lifestyle', 'stickers.yaml');
  if (!fs.existsSync(stickersYamlPath)) return;
  try {
    const parsed = yaml.parse(fs.readFileSync(stickersYamlPath, 'utf8'));
    const stickersObj = parsed?.stickers;
    if (!stickersObj || typeof stickersObj !== 'object') return;
    for (const catMap of Object.values(stickersObj)) {
      if (!catMap || typeof catMap !== 'object') continue;
      for (const [term, rule] of Object.entries(catMap)) {
        if (rule?.type !== 'image' || typeof rule.src !== 'string') continue;
        const safeSrc = sanitizeStickerImageSrc(rule.src);
        const slug = safeSrc ? normalizeSlug(term) : '';
        if (!slug || catalog.has(slug)) continue;
        const fileStem = normalizeSlug(path.basename(safeSrc, '.svg'));
        const license = PRIDE_SVG_NAMES.has(fileStem) ? defaultPrideLicense : defaultOtherLicense;
        catalog.set(slug, { src: safeSrc, license });
      }
    }
  } catch {
    // Ignore malformed stickers.yaml during fallback
  }
}

/**
 * Loads bundled CC0-1.0 / MIT sticker SVG entries from profile and public asset directories
 * and `profiles/lifestyle/stickers.yaml`.
 *
 * @param {string} [repoRoot]
 * @returns {Map<string, { src: string, license: 'CC0-1.0' | 'MIT' }>}
 */
export function loadBundledStickerCatalog(repoRoot = REPO_ROOT) {
  const allowedLicenses = loadAllowedBundledLicenses(repoRoot);
  const defaultPrideLicense = allowedLicenses.has('CC0-1.0') ? 'CC0-1.0' : 'MIT';
  const defaultOtherLicense = allowedLicenses.has('MIT') ? 'MIT' : 'CC0-1.0';

  const catalog = new Map();
  scanAssetDirectories(catalog, repoRoot, defaultPrideLicense, defaultOtherLicense);
  scanStickersYaml(catalog, repoRoot, defaultPrideLicense, defaultOtherLicense);

  // Common identity aliases that map directly to bundled CC0-1.0 assets
  if (catalog.has('nonbinary')) {
    const nb = catalog.get('nonbinary');
    if (!catalog.has('non-binary')) catalog.set('non-binary', nb);
    if (!catalog.has('enby')) catalog.set('enby', nb);
  }

  return catalog;
}

/**
 * Attempts to match a proposed `{ label, tag, category }` to a bundled CC0-1.0 / MIT SVG sticker.
 * Returns `null` if no bundled SVG matches.
 *
 * @param {{ label?: string, tag?: string, category?: string }} input
 * @param {{ repoRoot?: string }} [options]
 * @returns {{ source: 'bundled', src: string, license: 'CC0-1.0' | 'MIT', sticker: { type: 'image', src: string } } | null}
 */
export function matchBundledSticker(input = {}, options = {}) {
  const catalog = loadBundledStickerCatalog(options.repoRoot);
  const candidates = [input.tag, input.label]
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => normalizeSlug(v))
    .filter(Boolean);

  for (const slug of candidates) {
    const hit = catalog.get(slug);
    if (hit) {
      return {
        source: 'bundled',
        src: hit.src,
        license: hit.license,
        sticker: { type: 'image', src: hit.src },
      };
    }
  }

  return null;
}

function resolveSeedTag(input) {
  if (typeof input.tag === 'string' && input.tag.trim()) {
    return input.tag.trim().toLowerCase();
  }
  if (typeof input.label === 'string' && input.label.trim()) {
    return input.label.trim().toLowerCase();
  }
  return 'sticker';
}

/**
 * Generates a deterministic, constrained geometric SVG (`viewBox="0 0 64 64"`)
 * using only `svg`, `rect`, `circle`, `polygon`, `path`, and `line` elements,
 * with zero interpolated user text, zero scripts/handlers, and zero external URLs.
 * Always passes the result through `sanitizeSvg`.
 *
 * @param {{ label?: string, tag?: string, category?: string }} [input]
 * @returns {string}
 */
export function synthesizeGeometricSvg(input = {}) {
  const category =
    typeof input.category === 'string' && input.category.trim()
      ? input.category.trim().toLowerCase()
      : 'interests';
  const seedKey = `${category}:${resolveSeedTag(input)}`;

  const digest = crypto.createHash('sha256').update(seedKey).digest();
  const palette = GEOMETRIC_PALETTES[digest[0] % GEOMETRIC_PALETTES.length];
  const [c1, c2, c3] = palette;
  const motif = digest[1] % 4;
  const rot = (digest[2] % 4) * 15;

  let shapes;
  if (motif === 0) {
    shapes =
      `<rect x="6" y="6" width="52" height="52" fill="${c1}" opacity="0.2" />` +
      `<circle cx="32" cy="32" r="22" fill="${c1}" />` +
      `<polygon points="32,14 48,32 32,50 16,32" fill="${c2}" />` +
      `<circle cx="32" cy="32" r="7" fill="${c3}" />`;
  } else if (motif === 1) {
    shapes =
      `<circle cx="32" cy="32" r="26" fill="${c1}" />` +
      `<rect x="18" y="18" width="28" height="28" fill="${c2}" transform="rotate(${rot} 32 32)" />` +
      `<line x1="14" y1="32" x2="50" y2="32" stroke="${c3}" stroke-width="3" />` +
      `<line x1="32" y1="14" x2="32" y2="50" stroke="${c3}" stroke-width="3" />`;
  } else if (motif === 2) {
    shapes =
      `<polygon points="32,6 58,26 48,56 16,56 6,26" fill="${c1}" />` +
      `<polygon points="32,14 50,28 43,50 21,50 14,28" fill="${c2}" />` +
      `<circle cx="32" cy="34" r="8" fill="${c3}" />`;
  } else {
    shapes =
      `<rect x="8" y="8" width="48" height="48" fill="${c1}" />` +
      `<path d="M 16 44 L 32 16 L 48 44 Z" fill="${c2}" />` +
      `<circle cx="32" cy="36" r="6" fill="${c3}" />`;
  }

  const rawSvg = `<svg viewBox="0 0 64 64" width="64" height="64">${shapes}</svg>`;
  const sanitized = sanitizeSvg(rawSvg);
  if (!sanitized) {
    return '<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="24" fill="#6366f1" /></svg>';
  }
  return sanitized;
}

/**
 * Matches a proposed tag against bundled CC0-1.0/MIT SVGs, falling back to
 * constrained geometric SVG synthesis when no bundled asset matches.
 *
 * @param {{ label?: string, tag?: string, category?: string }} [input]
 * @param {{ repoRoot?: string }} [options]
 */
export function matchOrSynthesizeSticker(input = {}, options = {}) {
  const matched = matchBundledSticker(input, options);
  if (matched) {
    return matched;
  }

  const svg = synthesizeGeometricSvg(input);
  return {
    source: 'synthesized',
    svg,
    license: 'CC0-1.0',
    sticker: { type: 'svg', svg },
  };
}
