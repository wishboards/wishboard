import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { validateRuleset, type Rule } from '@wishboards/matching-engine';

const REPO_ROOT = path.resolve(process.cwd());
const LIFESTYLE_DIR = path.join(REPO_ROOT, 'profiles', 'lifestyle');
const ANALYZER_CLI = path.join(REPO_ROOT, 'scripts', 'analyze-taxonomy.js');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSPHRASE = 'e2e-admin-password'; // gitleaks:allow

const PROVENANCE_CANDIDATES = [
  path.join(REPO_ROOT, 'profiles', 'lifestyle', 'provenance.yaml'),
  path.join(REPO_ROOT, 'profiles', 'lifestyle', 'provenance.json'),
  path.join(REPO_ROOT, 'profiles', 'provenance.yaml'),
  path.join(REPO_ROOT, 'profiles', 'provenance.json'),
  path.join(REPO_ROOT, 'scripts', 'taxonomy-provenance.json'),
  path.join(REPO_ROOT, 'scripts', 'taxonomy-provenance.yaml'),
];

interface ProvenanceEntry {
  source?: string;
  name?: string;
  repo?: string;
  license?: string;
  status?: string;
  approved?: boolean;
  attribution?: string;
  url?: string;
}

function findProvenanceManifestPath(): string {
  const found = PROVENANCE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  expect(
    found,
    `Expected provenance manifest at one of: ${PROVENANCE_CANDIDATES.join(', ')}`
  ).toBeTruthy();
  return found as string;
}

function loadProvenanceEntries(manifestPath: string): ProvenanceEntry[] {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = manifestPath.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.approvedSources) || Array.isArray(parsed?.excludedSources)) {
    const approved = Array.isArray(parsed?.approvedSources)
      ? parsed.approvedSources.map((e: Record<string, unknown>) => ({
          ...e,
          status: (e.status as string) ?? 'approved',
          approved: (e.approved as boolean) ?? true,
          url: (e.url as string) ?? (e.repository as string),
          attribution: (e.attribution as string) ?? (e.notes as string) ?? (e.repository as string),
        }))
      : [];
    const excluded = Array.isArray(parsed?.excludedSources)
      ? parsed.excludedSources.map((e: Record<string, unknown>) => ({
          ...e,
          status: (e.status as string) ?? 'excluded',
          approved: (e.approved as boolean) ?? false,
          url: (e.url as string) ?? (e.repository as string),
        }))
      : [];
    return [...approved, ...excluded];
  }
  if (Array.isArray(parsed?.sources)) return parsed.sources;
  if (Array.isArray(parsed?.catalogs)) return parsed.catalogs;
  if (Array.isArray(parsed?.entries)) return parsed.entries;
  return [];
}

function findEntryBySource(
  entries: ProvenanceEntry[],
  needle: string
): ProvenanceEntry | undefined {
  const lower = needle.toLowerCase();
  return entries.find((entry) => {
    const id =
      `${entry.source ?? ''} ${entry.name ?? ''} ${entry.repo ?? ''} ${entry.url ?? ''}`.toLowerCase();
    return id.includes(lower);
  });
}

async function getAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/users/login', {
    data: {
      username: ADMIN_USERNAME,
      passphrase: ADMIN_PASSPHRASE, // gitleaks:allow
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(typeof body.token).toBe('string');
  return body.token;
}

function createTempProfileDir(rules: unknown[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-profile-'));
  fs.writeFileSync(
    path.join(tmpDir, 'profile.yaml'),
    YAML.stringify({
      profile: 'e2e-temp',
      categories: [
        { id: 'gender', label: 'Gender', suggestions: ['Nonbinary', 'Woman', 'Man'] },
        { id: 'orientation', label: 'Orientation', suggestions: ['Queer', 'Pansexual'] },
        { id: 'role', label: 'Role', suggestions: ['Switch', 'Rigger', 'Rope Bunny'] },
      ],
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(tmpDir, 'rules.yaml'), YAML.stringify({ rules }), 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'stickers.yaml'), YAML.stringify({ stickers: {} }), 'utf8');
  return tmpDir;
}

function runAnalyzerCli(args: string[]) {
  return spawnSync(process.execPath, [ANALYZER_CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

test.describe('ADR 0013 Feature 1: validateRuleset(rules, options?)', () => {
  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('validates a clean ruleset via validateRuleset with valid: true and zero errors', () => {
      const result = validateRuleset([
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'enby',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
        {
          rule_type: 'cross_match',
          trigger_attribute: 'role',
          trigger_value: 'rigger',
          target_attribute: 'role',
          target_value: 'rope bunny',
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('accepts valid enrichment and expansion rules when created via admin /api/rules', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const uniqueTag = `e2e_tag_${Date.now()}`;
      const createRes = await request.post('/api/rules', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          rule_type: 'enrichment',
          trigger_attribute: 'orientation',
          trigger_value: uniqueTag,
          target_attribute: 'orientation',
          target_value: 'queer',
        },
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      expect(created.id).toBeTruthy();

      const delRes = await request.delete(`/api/rules/${created.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.ok()).toBe(true);
    });

    test('validates cross_match, acceptance, and exclusion rules together without false positives', () => {
      const result = validateRuleset([
        {
          rule_type: 'acceptance',
          trigger_attribute: 'orientation',
          trigger_value: 'pansexual',
          target_attribute: 'gender',
          target_value: '*',
        },
        {
          rule_type: 'cross_match',
          trigger_attribute: 'role',
          trigger_value: 'dominant',
          target_attribute: 'role',
          target_value: 'submissive',
        },
        {
          rule_type: 'exclusion',
          trigger_attribute: 'role',
          trigger_value: 'monogamous',
          target_attribute: 'role',
          target_value: 'swinger',
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validates an empty ruleset cleanly', () => {
      const result = validateRuleset([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('CLI analyzer validates profiles/lifestyle ruleset with zero errors', () => {
      const result = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.validation?.valid).toBe(true);
      expect(parsed.validation?.errors ?? []).toHaveLength(0);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('detects expansion cycles (A -> B -> A and multi-hop A -> B -> C -> A) and reports validation errors', () => {
      const twoHopBody = validateRuleset([
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'alpha_term',
          target_attribute: 'gender',
          target_value: 'beta_term',
        },
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'beta_term',
          target_attribute: 'gender',
          target_value: 'alpha_term',
        },
      ]);
      expect(twoHopBody.valid).toBe(false);
      expect(twoHopBody.errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(twoHopBody.errors).toLowerCase()).toMatch(/cycle|circular/);

      const threeHopBody = validateRuleset([
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'hop_a',
          target_attribute: 'gender',
          target_value: 'hop_b',
        },
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'hop_b',
          target_attribute: 'gender',
          target_value: 'hop_c',
        },
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'hop_c',
          target_attribute: 'gender',
          target_value: 'hop_a',
        },
      ]);
      expect(threeHopBody.valid).toBe(false);
      expect(threeHopBody.errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(threeHopBody.errors).toLowerCase()).toMatch(/cycle|circular/);
    });

    test('detects expansion self-loop A -> A and reports validation error', () => {
      const body = validateRuleset([
        {
          rule_type: 'expansion',
          trigger_attribute: 'role',
          trigger_value: 'switch',
          target_attribute: 'role',
          target_value: 'switch',
        },
      ]);
      expect(body.valid).toBe(false);
      expect(body.errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(body.errors).toLowerCase()).toMatch(/self|cycle|loop/);
    });

    test('detects exclusion vs cross_match, acceptance, and expansion contradictions', () => {
      const pairs: Rule[] = [
        {
          rule_type: 'cross_match',
          trigger_attribute: 'role',
          trigger_value: 'rigger',
          target_attribute: 'role',
          target_value: 'rope bunny',
        },
        {
          rule_type: 'acceptance',
          trigger_attribute: 'orientation',
          trigger_value: 'pansexual',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'enby',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
      ];

      for (const positiveRule of pairs) {
        const body = validateRuleset([
          positiveRule,
          {
            rule_type: 'exclusion',
            trigger_attribute: positiveRule.trigger_attribute,
            trigger_value: positiveRule.trigger_value,
            target_attribute: positiveRule.target_attribute,
            target_value: positiveRule.target_value,
          },
        ]);
        expect(body.valid).toBe(false);
        expect(body.errors.length).toBeGreaterThan(0);
        expect(JSON.stringify(body.errors).toLowerCase()).toMatch(/contradict|conflict|exclusion/);
      }
    });

    test('rejects rules with empty trigger_value or empty target_value', () => {
      const body = validateRuleset([
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: '',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
        {
          rule_type: 'enrichment',
          trigger_attribute: 'orientation',
          trigger_value: 'lesbian',
          target_attribute: 'gender',
          target_value: '   ',
        },
      ]);
      expect(body.valid).toBe(false);
      expect(body.errors.length).toBeGreaterThanOrEqual(2);
    });

    test('detects duplicate rules and orphan references deterministically', () => {
      const rules: Rule[] = [
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'enby',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'enby',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
        {
          rule_type: 'enrichment',
          trigger_attribute: 'orphan_unknown_category',
          trigger_value: 'orphan_tag_xyz',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
      ];
      const options = { knownAttributes: ['gender', 'orientation', 'role'] };
      const body = validateRuleset(rules, options);
      const repeat = validateRuleset(rules, options);
      expect(body).toEqual(repeat);

      const allIssues = [...(body.errors ?? []), ...(body.warnings ?? [])];
      expect(allIssues.length).toBeGreaterThanOrEqual(2);
      const serializedIssues = JSON.stringify(allIssues).toLowerCase();
      expect(serializedIssues).toMatch(/duplicate/);
      expect(serializedIssues).toMatch(/orphan|unknown|category|reference/);
    });
  });
});

test.describe('ADR 0013 Feature 2: License & Provenance Manifest', () => {
  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('provenance manifest exists and parses as valid structured data', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      expect(entries.length).toBeGreaterThanOrEqual(4);
    });

    test('tracks fetlife/translations with Apache-2.0 approved license', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      const entry = findEntryBySource(entries, 'fetlife/translations');
      expect(entry).toBeDefined();
      expect(entry?.license).toBe('Apache-2.0');
      expect(entry?.status === 'approved' || entry?.approved === true).toBe(true);
    });

    test('tracks Goctionni/kinklist-v2 and @prideraiser/flags with MIT approved license', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      const kinklist = findEntryBySource(entries, 'kinklist-v2');
      const prideraiser = findEntryBySource(entries, 'prideraiser');
      expect(kinklist).toBeDefined();
      expect(kinklist?.license).toBe('MIT');
      expect(kinklist?.status === 'approved' || kinklist?.approved === true).toBe(true);

      expect(prideraiser).toBeDefined();
      expect(prideraiser?.license).toBe('MIT');
      expect(prideraiser?.status === 'approved' || prideraiser?.approved === true).toBe(true);
    });

    test('tracks Yellow-Dog-Man/PrideFlags with CC0-1.0 approved license', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      const prideFlags = findEntryBySource(entries, 'PrideFlags');
      expect(prideFlags).toBeDefined();
      expect(prideFlags?.license).toBe('CC0-1.0');
      expect(prideFlags?.status === 'approved' || prideFlags?.approved === true).toBe(true);
    });

    test('approved manifest entries include attribution metadata', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      const approved = entries.filter((e) => e.status === 'approved' || e.approved === true);
      expect(approved.length).toBeGreaterThanOrEqual(4);
      for (const entry of approved) {
        expect(entry.attribution || entry.url).toBeTruthy();
        expect(entry.license).toBeTruthy();
      }
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('explicitly excludes ContribuLibre/check-match (AGPL-3.0-or-later)', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      const checkMatch = findEntryBySource(entries, 'check-match');
      expect(checkMatch).toBeDefined();
      expect(checkMatch?.license).toMatch(/AGPL-3\.0/i);
      expect(
        checkMatch?.status?.toLowerCase() === 'excluded' || checkMatch?.approved === false
      ).toBe(true);
    });

    test('explicitly excludes microsoft/Pride-flag (CC BY-NC-SA 4.0)', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      const msPride = findEntryBySource(entries, 'microsoft/Pride-flag');
      expect(msPride).toBeDefined();
      expect(msPride?.license).toMatch(/CC[\s-]BY-NC-SA/i);
      expect(msPride?.status?.toLowerCase() === 'excluded' || msPride?.approved === false).toBe(
        true
      );
    });

    test('CLI rejects a manifest entry missing a license field', () => {
      const tmpDir = createTempProfileDir([]);
      try {
        const badManifest = path.join(tmpDir, 'bad-provenance.json');
        fs.writeFileSync(
          badManifest,
          JSON.stringify({
            sources: [{ source: 'unlicensed/repo', status: 'approved' }],
          }),
          'utf8'
        );
        const result = runAnalyzerCli([
          '--profile',
          tmpDir,
          '--manifest',
          badManifest,
          '--format',
          'json',
        ]);
        expect(result.status).not.toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('CLI blocks unvetted external URLs or unapproved copyleft licenses', () => {
      const tmpDir = createTempProfileDir([]);
      try {
        const badManifest = path.join(tmpDir, 'copyleft-provenance.json');
        fs.writeFileSync(
          badManifest,
          JSON.stringify({
            sources: [
              {
                source: 'evil/agpl-pack',
                license: 'AGPL-3.0-or-later',
                status: 'approved',
                url: 'https://unvetted.example.com/pack.zip',
              },
            ],
          }),
          'utf8'
        );
        const result = runAnalyzerCli([
          '--profile',
          tmpDir,
          '--manifest',
          badManifest,
          '--format',
          'json',
        ]);
        expect(result.status).not.toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('manifest schema is deterministic with required fields on every entry', () => {
      const manifestPath = findProvenanceManifestPath();
      const entries = loadProvenanceEntries(manifestPath);
      for (const entry of entries) {
        expect(entry.source || entry.name).toBeTruthy();
        expect(entry.license).toBeTruthy();
        expect(entry.status !== undefined || entry.approved !== undefined).toBe(true);
      }
    });
  });
});

test.describe('ADR 0013 Feature 3: Curated Profile Taxonomy & Rules Expansion (profiles/lifestyle)', () => {
  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('profiles/lifestyle/profile.yaml includes ENM/polyamorous taxonomy entries', () => {
      const profile = YAML.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'profile.yaml'), 'utf8'));
      const serialized = JSON.stringify(profile).toLowerCase();
      expect(serialized).toMatch(/polyamorous|enm|ethical non-monogamy|relationship/);
    });

    test('profiles/lifestyle/profile.yaml includes LGBTQIA+ categories and suggestions', () => {
      const profile = YAML.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'profile.yaml'), 'utf8'));
      const genderCat = profile.categories?.find((c: { id: string }) => c.id === 'gender');
      const orientationCat = profile.categories?.find(
        (c: { id: string }) => c.id === 'orientation'
      );
      expect(genderCat?.suggestions).toEqual(
        expect.arrayContaining(['Nonbinary', 'Genderqueer', 'Agender'])
      );
      expect(orientationCat?.suggestions).toEqual(
        expect.arrayContaining(['Queer', 'Pansexual', 'Demisexual'])
      );
    });

    test('profiles/lifestyle/profile.yaml includes BDSM/kink roles & practices', () => {
      const profile = YAML.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'profile.yaml'), 'utf8'));
      const roleCat = profile.categories?.find((c: { id: string }) => c.id === 'role');
      expect(roleCat?.suggestions).toEqual(
        expect.arrayContaining(['Dominant', 'Submissive', 'Switch', 'Rigger', 'Rope Bunny'])
      );
    });

    test('profiles/lifestyle/rules.yaml contains all 5 rule types', () => {
      const rulesDoc = YAML.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'rules.yaml'), 'utf8'));
      const ruleTypes = new Set(
        (rulesDoc?.rules ?? []).map((r: { rule_type: string }) => r.rule_type)
      );
      expect(ruleTypes.has('enrichment')).toBe(true);
      expect(ruleTypes.has('acceptance')).toBe(true);
      expect(ruleTypes.has('expansion')).toBe(true);
      expect(ruleTypes.has('cross_match')).toBe(true);
      expect(ruleTypes.has('exclusion')).toBe(true);
    });

    test('profiles/lifestyle/stickers.yaml configures stickers including CC0/MIT assets', () => {
      const stickersDoc = YAML.parse(
        fs.readFileSync(path.join(LIFESTYLE_DIR, 'stickers.yaml'), 'utf8')
      );
      expect(stickersDoc?.stickers).toBeDefined();
      expect(Object.keys(stickersDoc.stickers).length).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('preserves Top/Bottom vs Dominant/Submissive distinction in rules.yaml', () => {
      const rulesDoc = YAML.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'rules.yaml'), 'utf8'));
      const rules = rulesDoc?.rules ?? [];
      const conflatingExpansion = rules.find(
        (r: { rule_type: string; trigger_value: string; target_value: string }) =>
          r.rule_type === 'expansion' &&
          ((r.trigger_value === 'top' && r.target_value === 'dominant') ||
            (r.trigger_value === 'dominant' && r.target_value === 'top') ||
            (r.trigger_value === 'bottom' && r.target_value === 'submissive') ||
            (r.trigger_value === 'submissive' && r.target_value === 'bottom'))
      );
      expect(conflatingExpansion).toBeUndefined();
    });

    test('zero validation errors on profiles/lifestyle/rules.yaml via validateRuleset', () => {
      const rulesDoc = YAML.parse(fs.readFileSync(path.join(LIFESTYLE_DIR, 'rules.yaml'), 'utf8'));
      const body = validateRuleset(rulesDoc?.rules ?? []);
      expect(body.valid).toBe(true);
      expect(body.errors).toEqual([]);
    });

    test('no AGPL or CC-BY-NC-SA assets exist in profiles/lifestyle/assets', () => {
      const assetsDir = path.join(LIFESTYLE_DIR, 'assets');
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        for (const file of files) {
          const fullPath = path.join(assetsDir, file);
          if (fs.statSync(fullPath).isFile()) {
            const content = fs.readFileSync(fullPath, 'utf8');
            expect(content).not.toMatch(/AGPL-3\.0|CC[\s-]BY-NC-SA/i);
          }
        }
      }
      expect(fs.existsSync(LIFESTYLE_DIR)).toBe(true);
    });

    test('matching works for ENM/BDSM/queer tags via live /api/wishes search API', async ({
      request,
    }) => {
      const uniqueContent = `E2E Taxonomy Match ${Date.now()}`;
      const createRes = await request.post('/api/wishes', {
        data: {
          content: uniqueContent,
          creator_attributes: {
            gender: ['Nonbinary'],
            orientation: ['Queer'],
            role: ['Rigger'],
          },
          desired_attributes: {
            role: ['Rope Bunny'],
          },
        },
      });
      expect(createRes.ok()).toBe(true);

      const searchRes = await request.get('/api/wishes', {
        params: {
          q: uniqueContent,
          gender: 'Nonbinary',
          orientation: 'Queer',
          role: 'Rope Bunny',
        },
      });
      expect(searchRes.ok()).toBe(true);
      const results = await searchRes.json();
      const list = Array.isArray(results) ? results : (results.wishes ?? []);
      expect(list.some((w: { content: string }) => w.content === uniqueContent)).toBe(true);
    });

    test('unknown or empty tags are handled cleanly by /api/rules/check-conflicts', async ({
      request,
    }) => {
      const res = await request.post('/api/rules/check-conflicts', {
        data: {
          attributes: {
            gender: ['unknown_custom_gender_xyz'],
            orientation: [],
            role: '',
          },
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.conflicts)).toBe(true);
    });
  });
});

test.describe('ADR 0013 Feature 4: scripts/analyze-taxonomy CLI', () => {
  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('runs offline on profiles/lifestyle via execFileSync and exits 0', () => {
      const stdout = execFileSync(
        process.execPath,
        [ANALYZER_CLI, '--profile', LIFESTYLE_DIR, '--format', 'json'],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 }
      );
      expect(stdout.trim().length).toBeGreaterThan(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toBeDefined();
    });

    test('outputs structured YAML and JSON diff formats', () => {
      const jsonOut = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'json']);
      expect(jsonOut.status).toBe(0);
      expect(() => JSON.parse(jsonOut.stdout)).not.toThrow();

      const yamlOut = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'yaml']);
      expect(yamlOut.status).toBe(0);
      expect(() => YAML.parse(yamlOut.stdout)).not.toThrow();
    });

    test('checks profile against license-vetted seed catalogs', () => {
      const result = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.licenseAudit || parsed.provenance || parsed.seeds).toBeDefined();
    });

    test('supports anonymized board export input via --export', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-export-'));
      try {
        const exportPath = path.join(tmpDir, 'anon-export.json');
        fs.writeFileSync(
          exportPath,
          JSON.stringify({
            wishes: [
              {
                creator_attributes: {
                  gender: ['Nonbinary'],
                  orientation: ['Queer'],
                  role: ['Service Top'],
                },
              },
            ],
          }),
          'utf8'
        );
        const result = runAnalyzerCli([
          '--profile',
          LIFESTYLE_DIR,
          '--export',
          exportPath,
          '--format',
          'json',
        ]);
        expect(result.status).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.validation?.valid).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('validates output ruleset with validateRuleset and reports validation status', () => {
      const result = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(typeof parsed.validation?.valid).toBe('boolean');
      expect(Array.isArray(parsed.validation?.errors)).toBe(true);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('exits non-zero on invalid/cyclic ruleset', () => {
      const tmpDir = createTempProfileDir([
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'cycle_a',
          target_attribute: 'gender',
          target_value: 'cycle_b',
        },
        {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'cycle_b',
          target_attribute: 'gender',
          target_value: 'cycle_a',
        },
      ]);
      try {
        const result = runAnalyzerCli(['--profile', tmpDir, '--format', 'json']);
        expect(result.status).not.toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('exits non-zero on license violation in manifest', () => {
      const tmpDir = createTempProfileDir([]);
      try {
        const badManifest = path.join(tmpDir, 'bad-manifest.json');
        fs.writeFileSync(
          badManifest,
          JSON.stringify({
            sources: [
              {
                source: 'ContribuLibre/check-match',
                license: 'AGPL-3.0-or-later',
                status: 'approved',
              },
            ],
          }),
          'utf8'
        );
        const result = runAnalyzerCli([
          '--profile',
          tmpDir,
          '--manifest',
          badManifest,
          '--format',
          'json',
        ]);
        expect(result.status).not.toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('handles missing or malformed profile path cleanly with non-zero exit', () => {
      const missingPath = path.join(os.tmpdir(), `nonexistent-profile-${Date.now()}`);
      const result = runAnalyzerCli(['--profile', missingPath, '--format', 'json']);
      expect(result.status).not.toBe(0);
      expect((result.stderr || result.stdout).length).toBeGreaterThan(0);
    });

    test('handles empty anonymized board export gracefully', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-empty-export-'));
      try {
        const exportPath = path.join(tmpDir, 'empty-export.json');
        fs.writeFileSync(exportPath, JSON.stringify({ wishes: [] }), 'utf8');
        const result = runAnalyzerCli([
          '--profile',
          LIFESTYLE_DIR,
          '--export',
          exportPath,
          '--format',
          'json',
        ]);
        expect(result.status).toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('produces deterministic output across repeated invocations', () => {
      const first = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'json']);
      const second = runAnalyzerCli(['--profile', LIFESTYLE_DIR, '--format', 'json']);
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(first.stdout).toBe(second.stdout);
    });
  });
});
