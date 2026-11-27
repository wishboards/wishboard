#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'yaml';
import { validateRuleset } from '@wishboards/matching-engine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Built-in license-vetted seed catalog derived from approved sources
 * documented in profiles/provenance.json.
 */
export const BUILTIN_SEED_CATALOG = {
  license: 'Apache-2.0',
  source: 'wishboard-curated-seed',
  categories: {
    gender: [
      'Cis Man',
      'Cis Woman',
      'Trans Man',
      'Trans Woman',
      'Nonbinary',
      'Genderqueer',
      'Agender',
      'Bigender',
      'Genderfluid',
      'Two-Spirit',
      'Intersex',
      'Demiboy',
      'Demigirl',
    ],
    orientation: [
      'Straight',
      'Gay',
      'Lesbian',
      'Bisexual',
      'Pansexual',
      'Asexual',
      'Aromantic',
      'Queer',
      'Demisexual',
      'Demiromantic',
      'Graysexual',
      'Polysexual',
      'Omnisexual',
      'Heteroflexible',
      'Homoflexible',
    ],
    role: [
      'Top',
      'Bottom',
      'Versatile',
      'Service Top',
      'Service Sub',
      'Dominant',
      'Submissive',
      'Switch',
      'Sadist',
      'Masochist',
      'Rigger',
      'Rope Bunny',
      'Handler',
      'Pup',
      'Pet',
      'Kitten',
      'Pony',
      'Brat',
      'Brat Tamer',
      'Primal',
      'Prey',
      'Master',
      'Mistress',
      'Slave',
      'Owner',
      'Property',
      'Caregiver',
      'Daddy',
      'Mommy',
      'Little',
    ],
    relationship_style: [
      'Polyamorous',
      'ENM',
      'Open Relationship',
      'Kitchen Table Poly',
      'Parallel Poly',
      'Solo Poly',
      'Relationship Anarchy',
      'Monogamous',
      'Monogamish',
      'Swinger',
    ],
    interests: [
      'Shibari',
      'Impact',
      'Sensory Play',
      'Bondage',
      'Power Exchange',
      'Praise',
      'Degradation',
      'Rope',
      'Wax Play',
      'Pet Play',
      'Aftercare',
      'Roleplay',
    ],
  },
  rules: [],
  stickers: {},
};

/**
 * Parse a JSON or YAML file based on content/extension.
 * @param {string} filePath
 * @returns {unknown}
 */
export function parseStructuredFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) {
    return JSON.parse(raw);
  }
  return yaml.parse(raw);
}

/**
 * Parse CLI arguments for analyze-taxonomy.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  const opts = {
    profile: 'lifestyle',
    catalog: null,
    exportPath: null,
    bundlePath: null,
    provenance: path.join(DEFAULT_REPO_ROOT, 'profiles', 'provenance.json'),
    format: 'yaml',
    out: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--profile' && argv[i + 1]) {
      opts.profile = argv[++i];
    } else if (arg === '--catalog' && argv[i + 1]) {
      opts.catalog = argv[++i];
    } else if (arg === '--export' && argv[i + 1]) {
      opts.exportPath = argv[++i];
    } else if (arg === '--bundle' && argv[i + 1]) {
      opts.bundlePath = argv[++i];
    } else if (arg === '--provenance' && argv[i + 1]) {
      opts.provenance = argv[++i];
    } else if (arg === '--format' && argv[i + 1]) {
      opts.format = argv[++i].toLowerCase();
    } else if (arg === '--out' && argv[i + 1]) {
      opts.out = argv[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }

  if (opts.format !== 'yaml' && opts.format !== 'json') {
    throw new Error(`Unsupported --format "${opts.format}". Expected "yaml" or "json".`);
  }

  return opts;
}

/**
 * Validate a provenance manifest and optional external catalog against license rules.
 * @param {object} provenance
 * @param {object | null} [catalog]
 */
export function validateLicenseGate(provenance, catalog = null) {
  const errors = [];
  if (!provenance || typeof provenance !== 'object') {
    return { valid: false, errors: ['Provenance manifest must be a valid JSON/YAML object.'] };
  }

  const allowedLicenses = Array.isArray(provenance.allowedLicenses)
    ? provenance.allowedLicenses.map((l) => String(l).trim()).filter(Boolean)
    : [];
  const excludedLicenses = Array.isArray(provenance.excludedLicenses)
    ? provenance.excludedLicenses.map((l) => String(l).trim()).filter(Boolean)
    : [];

  if (allowedLicenses.length === 0) {
    errors.push('Provenance manifest must define a non-empty allowedLicenses array.');
  }

  const allowedSet = new Set(allowedLicenses);
  const excludedSet = new Set(excludedLicenses);
  const excludedSourceNames = new Set(
    (Array.isArray(provenance.excludedSources) ? provenance.excludedSources : [])
      .flatMap((entry) =>
        typeof entry === 'string'
          ? [entry]
          : [entry?.source, entry?.id].filter((v) => typeof v === 'string')
      )
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  const checkExcludedSource = (sourceValue, idValue, label) => {
    const candidates = [sourceValue, idValue]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim().toLowerCase());
    const matched = candidates.find((c) => excludedSourceNames.has(c));
    if (matched) {
      errors.push(`${label} is from strictly excluded source "${matched}".`);
    }
  };

  const checkLicense = (license, label) => {
    if (typeof license !== 'string' || !license.trim()) {
      errors.push(`${label} is missing a required license identifier.`);
      return;
    }
    const trimmed = license.trim();
    if (excludedSet.has(trimmed)) {
      errors.push(`${label} uses strictly excluded license "${trimmed}".`);
      return;
    }
    if (!allowedSet.has(trimmed)) {
      errors.push(
        `${label} uses unapproved license "${trimmed}". Allowed: ${allowedLicenses.join(', ')}.`
      );
    }
  };

  if (Array.isArray(provenance.approvedSources)) {
    for (const src of provenance.approvedSources) {
      checkLicense(src?.license, `Approved source "${src?.source || src?.id || 'unknown'}"`);
    }
  }

  if (catalog !== null) {
    if (!catalog || typeof catalog !== 'object') {
      errors.push('Catalog must be a valid JSON or YAML object.');
    } else {
      checkExcludedSource(
        catalog.source,
        catalog.id,
        `Catalog "${catalog.source || catalog.id || 'external'}"`
      );
      if (catalog.license !== undefined) {
        checkLicense(catalog.license, `Catalog "${catalog.source || 'external'}"`);
      } else if (!Array.isArray(catalog.sources)) {
        errors.push('Catalog must declare a top-level "license" or "sources" array.');
      }

      if (Array.isArray(catalog.sources)) {
        for (const src of catalog.sources) {
          const label = `Catalog source "${src?.source || src?.id || 'unknown'}"`;
          checkExcludedSource(src?.source, src?.id, label);
          checkLicense(src?.license, label);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    allowedLicenses,
    excludedLicenses,
  };
}

/**
 * Load profile YAML files (profile.yaml, rules.yaml, stickers.yaml) from a profile directory.
 * @param {string} profileDir
 */
export function loadProfileFiles(profileDir) {
  const profilePath = path.join(profileDir, 'profile.yaml');
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found at ${profilePath}`);
  }

  const profileData = yaml.parse(fs.readFileSync(profilePath, 'utf8')) || {};
  const rulesPath = path.join(profileDir, 'rules.yaml');
  const stickersPath = path.join(profileDir, 'stickers.yaml');

  const rulesData = fs.existsSync(rulesPath)
    ? yaml.parse(fs.readFileSync(rulesPath, 'utf8')) || {}
    : {};
  const stickersData = fs.existsSync(stickersPath)
    ? yaml.parse(fs.readFileSync(stickersPath, 'utf8')) || {}
    : {};

  const rules = Array.isArray(rulesData.rules)
    ? rulesData.rules
    : Array.isArray(profileData.rules)
      ? profileData.rules
      : [];

  const stickers =
    stickersData.stickers && typeof stickersData.stickers === 'object'
      ? stickersData.stickers
      : profileData.stickers && typeof profileData.stickers === 'object'
        ? profileData.stickers
        : {};

  return {
    profile: profileData,
    categories: Array.isArray(profileData.categories) ? profileData.categories : [],
    rules,
    stickers,
  };
}

/**
 * Extract unmapped terms from an anonymized board export payload.
 * @param {unknown} exportPayload
 * @param {Array<{ id: string, suggestions?: string[] }>} existingCategories
 */
export function extractUnmappedExportTerms(exportPayload, existingCategories) {
  if (!exportPayload) return [];

  const knownTermsByCat = new Map();
  const allKnownTerms = new Set();

  for (const cat of existingCategories) {
    const set = new Set((cat.suggestions || []).map((s) => String(s).trim().toLowerCase()));
    knownTermsByCat.set(cat.id, set);
    for (const term of set) allKnownTerms.add(term);
  }

  const unmapped = [];
  const seen = new Set();

  const recordTerm = (category, term) => {
    if (typeof term !== 'string') return;
    const trimmed = term.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const catSet = category ? knownTermsByCat.get(category) : null;
    const isKnown = category ? Boolean(catSet?.has(lower)) : allKnownTerms.has(lower);
    if (isKnown) return;
    const key = `${category || '*'}::${lower}`;
    if (seen.has(key)) return;
    seen.add(key);
    unmapped.push({ category: category || null, term: trimmed });
  };

  if (Array.isArray(exportPayload)) {
    for (const item of exportPayload) {
      if (typeof item === 'string') {
        recordTerm(null, item);
      } else if (item && typeof item === 'object') {
        processWishAttributes(item, recordTerm);
      }
    }
    return unmapped;
  }

  if (typeof exportPayload === 'object') {
    if (Array.isArray(exportPayload.unmappedTerms)) {
      for (const term of exportPayload.unmappedTerms) {
        if (typeof term === 'string') {
          recordTerm(null, term);
        } else if (term && typeof term === 'object' && typeof term.term === 'string') {
          recordTerm(term.category || null, term.term);
        }
      }
    } else if (exportPayload.unmappedTerms && typeof exportPayload.unmappedTerms === 'object') {
      for (const [cat, terms] of Object.entries(exportPayload.unmappedTerms)) {
        if (Array.isArray(terms)) {
          for (const t of terms) recordTerm(cat, t);
        }
      }
    }

    if (Array.isArray(exportPayload.wishes)) {
      for (const wish of exportPayload.wishes) {
        if (wish && typeof wish === 'object') {
          processWishAttributes(wish, recordTerm);
        }
      }
    }
  }

  return unmapped;
}

function processWishAttributes(wish, recordTerm) {
  for (const field of ['creator_attributes', 'desired_attributes', 'attributes']) {
    const attrMap = wish[field];
    if (!attrMap || typeof attrMap !== 'object' || Array.isArray(attrMap)) continue;
    for (const [cat, vals] of Object.entries(attrMap)) {
      if (Array.isArray(vals)) {
        for (const v of vals) recordTerm(cat, v);
      } else if (typeof vals === 'string') {
        recordTerm(cat, vals);
      }
    }
  }
}

/**
 * Build a reviewable proposal diff comparing existing profile against a seed catalog & optional export.
 */
export function buildTaxonomyAnalysis({
  profileName,
  profileData,
  provenanceCheck,
  catalog,
  exportPayload,
}) {
  const seed = catalog || BUILTIN_SEED_CATALOG;
  const existingCategories = profileData.categories || [];
  const existingRules = profileData.rules || [];
  const existingStickers = profileData.stickers || {};

  const categoryProposals = [];
  const seedCategories =
    seed.categories && typeof seed.categories === 'object' ? seed.categories : {};

  for (const [catId, seedTerms] of Object.entries(seedCategories)) {
    if (!Array.isArray(seedTerms)) continue;
    const existingCat = existingCategories.find((c) => c.id === catId);
    const existingSet = new Set(
      (existingCat?.suggestions || []).map((s) => String(s).trim().toLowerCase())
    );
    const missingSuggestions = seedTerms.filter(
      (t) => typeof t === 'string' && t.trim() && !existingSet.has(t.trim().toLowerCase())
    );

    if (!existingCat || missingSuggestions.length > 0) {
      categoryProposals.push({
        id: catId,
        isNewCategory: !existingCat,
        existingCount: existingSet.size,
        missingSuggestions,
      });
    }
  }

  const existingRuleIds = new Set(existingRules.map((r) => r?.id).filter(Boolean));
  const seedRules = Array.isArray(seed.rules) ? seed.rules : [];
  const proposedRules = seedRules.filter((r) => r && (!r.id || !existingRuleIds.has(r.id)));

  const combinedRules = [...existingRules, ...proposedRules];
  const validation = validateRuleset(combinedRules);

  const stickerProposals = [];
  const seedStickers = seed.stickers && typeof seed.stickers === 'object' ? seed.stickers : {};
  for (const [catId, stickerMap] of Object.entries(seedStickers)) {
    if (!stickerMap || typeof stickerMap !== 'object') continue;
    const existingCatStickers = existingStickers[catId] || {};
    const existingTermKeys = new Set(
      Object.keys(existingCatStickers).map((k) => k.trim().toLowerCase())
    );
    for (const [term, rule] of Object.entries(stickerMap)) {
      if (!existingTermKeys.has(term.trim().toLowerCase())) {
        stickerProposals.push({ category: catId, term, proposedRule: rule });
      }
    }
  }

  const unmappedExportTerms = extractUnmappedExportTerms(exportPayload, existingCategories);

  const existingSuggestionsCount = existingCategories.reduce(
    (sum, cat) => sum + (Array.isArray(cat.suggestions) ? cat.suggestions.length : 0),
    0
  );
  const existingStickersCount = Object.values(existingStickers).reduce(
    (sum, map) => sum + (map && typeof map === 'object' ? Object.keys(map).length : 0),
    0
  );

  return {
    profile: profileName,
    provenance: {
      valid: provenanceCheck.valid,
      allowedLicenses: provenanceCheck.allowedLicenses,
      excludedLicenses: provenanceCheck.excludedLicenses,
      ...(catalog?.license ? { catalogLicense: catalog.license } : {}),
    },
    validation,
    proposals: {
      categories: categoryProposals,
      rules: proposedRules,
      stickers: stickerProposals,
      unmappedExportTerms,
    },
    summary: {
      existingCategories: existingCategories.length,
      existingSuggestions: existingSuggestionsCount,
      existingRules: existingRules.length,
      existingStickers: existingStickersCount,
      proposedCategoryAdditions: categoryProposals.reduce(
        (sum, c) => sum + c.missingSuggestions.length,
        0
      ),
      proposedRuleAdditions: proposedRules.length,
      proposedStickerAdditions: stickerProposals.length,
      unmappedExportCount: unmappedExportTerms.length,
    },
  };
}

/**
 * Execute the full analysis pipeline and return { exitCode, output, analysis }.
 * @param {string[]} argv
 * @param {{ repoRoot?: string }} [env]
 */
export function runAnalyzeTaxonomy(argv, env = {}) {
  const repoRoot = env.repoRoot || DEFAULT_REPO_ROOT;
  const opts = parseCliArgs(argv);

  if (opts.help) {
    return {
      exitCode: 0,
      output: [
        'Usage: node scripts/analyze-taxonomy.js [options]',
        '',
        'Options:',
        '  --profile <name>      Profile directory name under profiles/ (default: lifestyle)',
        '  --catalog <path>      Optional JSON/YAML seed catalog with license metadata',
        '  --export <path>       Optional anonymized board export JSON/YAML',
        '  --bundle <path>       Optional exported YAML/SVG patch bundle JSON/YAML',
        '  --provenance <path>   Provenance manifest JSON/YAML (default: profiles/provenance.json)',
        '  --format <yaml|json>  Output format (default: yaml)',
        '  --out <path>          Optional output file path',
        '  --help                Show this help message',
      ].join('\n'),
      analysis: null,
    };
  }

  const provenancePath = path.resolve(repoRoot, opts.provenance);
  const provenance = parseStructuredFile(provenancePath);

  const catalog = opts.catalog ? parseStructuredFile(path.resolve(repoRoot, opts.catalog)) : null;
  const provenanceCheck = validateLicenseGate(provenance, catalog);

  if (!provenanceCheck.valid) {
    return {
      exitCode: 1,
      output: `License gate failed:\n- ${provenanceCheck.errors.join('\n- ')}`,
      analysis: null,
    };
  }

  const exportPayload = opts.exportPath
    ? parseStructuredFile(path.resolve(repoRoot, opts.exportPath))
    : null;

  const profileDir = path.resolve(repoRoot, 'profiles', opts.profile);
  const profileData = loadProfileFiles(profileDir);

  if (opts.bundlePath) {
    const bundle = parseStructuredFile(path.resolve(repoRoot, opts.bundlePath));
    if (bundle && typeof bundle === 'object') {
      const parsedRules =
        typeof bundle.rulesYaml === 'string'
          ? yaml.parse(bundle.rulesYaml)?.rules
          : Array.isArray(bundle.rules)
            ? bundle.rules
            : null;
      if (Array.isArray(parsedRules)) {
        profileData.rules = parsedRules;
      }
      if (Array.isArray(bundle.categories)) {
        profileData.categories = bundle.categories;
      }
      if (
        bundle.stickers &&
        typeof bundle.stickers === 'object' &&
        !Array.isArray(bundle.stickers)
      ) {
        profileData.stickers = bundle.stickers;
      }
    }
  }

  const analysis = buildTaxonomyAnalysis({
    profileName: opts.profile,
    profileData,
    provenanceCheck,
    catalog,
    exportPayload,
  });

  const formatted =
    opts.format === 'json' ? JSON.stringify(analysis, null, 2) : yaml.stringify(analysis);

  if (opts.out) {
    const outPath = path.resolve(repoRoot, opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, formatted, 'utf8');
  }

  const exitCode = analysis.validation.valid ? 0 : 1;
  return { exitCode, output: formatted, analysis };
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    const { exitCode, output } = runAnalyzeTaxonomy(process.argv.slice(2));
    if (exitCode === 0) {
      console.log(output);
    } else {
      console.error(output);
    }
    process.exit(exitCode);
  } catch (err) {
    console.error(`analyze-taxonomy error: ${err.message}`);
    process.exit(1);
  }
}
