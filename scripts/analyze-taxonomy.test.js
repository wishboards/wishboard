import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import {
  buildTaxonomyAnalysis,
  extractUnmappedExportTerms,
  parseCliArgs,
  runAnalyzeTaxonomy,
  validateLicenseGate,
} from './analyze-taxonomy.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const tempDirs = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-taxonomy-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('analyze-taxonomy CLI', () => {
  it('parses CLI options and validates format', () => {
    const opts = parseCliArgs([
      '--profile',
      'lifestyle',
      '--format',
      'json',
      '--catalog',
      'cat.yaml',
      '--export',
      'exp.json',
      '--out',
      'out.json',
    ]);
    expect(opts.profile).toBe('lifestyle');
    expect(opts.format).toBe('json');
    expect(opts.catalog).toBe('cat.yaml');
    expect(opts.exportPath).toBe('exp.json');
    expect(opts.out).toBe('out.json');

    expect(() => parseCliArgs(['--format', 'xml'])).toThrow(/Unsupported --format/);
    expect(() => parseCliArgs(['--unknown-flag'])).toThrow(/Unknown or incomplete option/);
  });

  it('returns help text when --help is passed', () => {
    const res = runAnalyzeTaxonomy(['--help'], { repoRoot: REPO_ROOT });
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('Usage: node scripts/analyze-taxonomy.js');
  });

  it('analyzes the lifestyle profile in YAML and JSON formats with zero errors', () => {
    const yamlRes = runAnalyzeTaxonomy(['--profile', 'lifestyle', '--format', 'yaml'], {
      repoRoot: REPO_ROOT,
    });
    expect(yamlRes.exitCode).toBe(0);
    expect(yamlRes.analysis?.validation.valid).toBe(true);
    expect(yamlRes.analysis?.validation.errors).toEqual([]);
    const parsedYaml = yaml.parse(yamlRes.output);
    expect(parsedYaml.profile).toBe('lifestyle');

    const tmp = createTempDir();
    const outFile = path.join(tmp, 'report.json');
    const jsonRes = runAnalyzeTaxonomy(
      ['--profile', 'lifestyle', '--format', 'json', '--out', outFile],
      { repoRoot: REPO_ROOT }
    );
    expect(jsonRes.exitCode).toBe(0);
    const parsedJson = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(parsedJson.provenance.valid).toBe(true);
    expect(parsedJson.summary.existingCategories).toBeGreaterThanOrEqual(5);
  });

  it('diffs --catalog and --export against an existing profile', () => {
    const tmp = createTempDir();
    const profileDir = path.join(tmp, 'profiles', 'custom');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'profiles', 'provenance.json'),
      path.join(tmp, 'profiles', 'provenance.json')
    );

    fs.writeFileSync(
      path.join(profileDir, 'profile.yaml'),
      yaml.stringify({
        profile: 'custom',
        categories: [{ id: 'gender', label: 'Gender', suggestions: ['Woman'] }],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(profileDir, 'rules.yaml'), yaml.stringify({ rules: [] }), 'utf8');
    fs.writeFileSync(
      path.join(profileDir, 'stickers.yaml'),
      yaml.stringify({ stickers: { gender: { woman: { type: 'icon', iconType: 'female' } } } }),
      'utf8'
    );

    const catalogPath = path.join(tmp, 'catalog.yaml');
    fs.writeFileSync(
      catalogPath,
      yaml.stringify({
        license: 'MIT',
        source: 'Goctionni/kinklist-v2',
        categories: {
          gender: ['Woman', 'Nonbinary'],
          interests: ['Shibari'],
        },
        rules: [
          {
            id: 'cross_top_bottom',
            rule_type: 'cross_match',
            trigger_attribute: 'role',
            trigger_value: 'top',
            target_attribute: 'role',
            target_value: 'bottom',
          },
        ],
        stickers: {
          interests: {
            shibari: { type: 'image', src: '/assets/stickers/shibari.svg' },
          },
        },
      }),
      'utf8'
    );

    const exportPath = path.join(tmp, 'export.json');
    fs.writeFileSync(
      exportPath,
      JSON.stringify({
        unmappedTerms: { role: ['Brat Tamer', 'Woman'] },
        wishes: [
          {
            creator_attributes: { relationship_style: ['Solo Poly'] },
            desired_attributes: { interests: ['Impact'] },
          },
        ],
      }),
      'utf8'
    );

    const res = runAnalyzeTaxonomy(
      [
        '--profile',
        'custom',
        '--provenance',
        'profiles/provenance.json',
        '--catalog',
        catalogPath,
        '--export',
        exportPath,
        '--format',
        'json',
      ],
      { repoRoot: tmp }
    );

    expect(res.exitCode).toBe(0);
    expect(res.analysis?.proposals.categories).toEqual([
      {
        id: 'gender',
        isNewCategory: false,
        existingCount: 1,
        missingSuggestions: ['Nonbinary'],
      },
      {
        id: 'interests',
        isNewCategory: true,
        existingCount: 0,
        missingSuggestions: ['Shibari'],
      },
    ]);
    expect(res.analysis?.proposals.rules).toHaveLength(1);
    expect(res.analysis?.proposals.stickers).toHaveLength(1);
    expect(res.analysis?.proposals.unmappedExportTerms).toEqual([
      { category: 'role', term: 'Brat Tamer' },
      { category: 'role', term: 'Woman' },
      { category: 'relationship_style', term: 'Solo Poly' },
      { category: 'interests', term: 'Impact' },
    ]);
  });

  it('exits non-zero when validateRuleset detects cycles or contradictions', () => {
    const tmp = createTempDir();
    const profileDir = path.join(tmp, 'profiles', 'broken');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'profiles', 'provenance.json'),
      path.join(tmp, 'profiles', 'provenance.json')
    );

    fs.writeFileSync(
      path.join(profileDir, 'profile.yaml'),
      yaml.stringify({ profile: 'broken', categories: [] }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(profileDir, 'rules.yaml'),
      yaml.stringify({
        rules: [
          {
            id: 'cycle_a',
            rule_type: 'expansion',
            trigger_attribute: 'gender',
            trigger_value: 'a',
            target_attribute: 'gender',
            target_value: 'b',
          },
          {
            id: 'cycle_b',
            rule_type: 'expansion',
            trigger_attribute: 'gender',
            trigger_value: 'b',
            target_attribute: 'gender',
            target_value: 'a',
          },
        ],
      }),
      'utf8'
    );

    const res = runAnalyzeTaxonomy(
      ['--profile', 'broken', '--provenance', 'profiles/provenance.json', '--format', 'json'],
      { repoRoot: tmp }
    );

    expect(res.exitCode).toBe(1);
    expect(res.analysis?.validation.valid).toBe(false);
    expect(res.analysis?.validation.errors.some((e) => e.code === 'EXPANSION_CYCLE')).toBe(true);
  });

  it.each(['AGPL-3.0-or-later', 'CC BY-NC-SA 4.0', 'GPL-3.0-only'])(
    'exits non-zero when catalog uses excluded or unapproved license %s',
    (badLicense) => {
      const tmp = createTempDir();
      const catalogPath = path.join(tmp, 'bad-catalog.json');
      fs.writeFileSync(
        catalogPath,
        JSON.stringify({ source: 'forbidden/repo', license: badLicense, categories: {} }),
        'utf8'
      );

      const res = runAnalyzeTaxonomy(['--profile', 'lifestyle', '--catalog', catalogPath], {
        repoRoot: REPO_ROOT,
      });

      expect(res.exitCode).toBe(1);
      expect(res.output).toContain('License gate failed');
      expect(res.output).toContain(badLicense);
    }
  );

  it('validates license gate edge cases and export array extraction', () => {
    const provenance = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'profiles', 'provenance.json'), 'utf8')
    );
    expect(
      validateLicenseGate(provenance, { sources: [{ id: 's1', license: 'CC0-1.0' }] }).valid
    ).toBe(true);
    expect(validateLicenseGate(provenance, {}).valid).toBe(false);
    expect(validateLicenseGate(null, null).valid).toBe(false);

    const unmapped = extractUnmappedExportTerms(
      ['NewTerm', { attributes: { role: 'Rigger' } }],
      [{ id: 'role', suggestions: ['Rigger'] }]
    );
    expect(unmapped).toEqual([{ category: null, term: 'NewTerm' }]);
  });

  it('enforces excludedSources even with forged allowed license and matches sticker keys case-insensitively', () => {
    const provenance = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'profiles', 'provenance.json'), 'utf8')
    );
    const gate = validateLicenseGate(provenance, {
      source: 'ContribuLibre/check-match',
      license: 'MIT',
    });
    expect(gate.valid).toBe(false);
    expect(gate.errors.some((e) => e.includes('excluded source'))).toBe(true);

    const analysis = buildTaxonomyAnalysis({
      profileName: 'test',
      profileData: {
        categories: [],
        rules: [],
        stickers: {
          interests: { shibari: { type: 'image', src: '/assets/stickers/shibari.svg' } },
        },
      },
      provenanceCheck: { valid: true, allowedLicenses: ['MIT'], excludedLicenses: [] },
      catalog: {
        source: 'safe/repo',
        license: 'MIT',
        stickers: {
          interests: { Shibari: { type: 'image', src: '/assets/stickers/shibari.svg' } },
        },
      },
    });
    expect(analysis.proposals.stickers).toEqual([]);
  });

  it('supports --bundle mode and ignores array-typed bundle.stickers', () => {
    const tmp = createTempDir();
    const profileDir = path.join(tmp, 'profiles', 'bundled');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'profiles', 'provenance.json'),
      path.join(tmp, 'profiles', 'provenance.json')
    );
    fs.writeFileSync(
      path.join(profileDir, 'profile.yaml'),
      yaml.stringify({ profile: 'bundled', categories: [] }),
      'utf8'
    );
    fs.writeFileSync(path.join(profileDir, 'rules.yaml'), yaml.stringify({ rules: [] }), 'utf8');

    const bundlePath = path.join(tmp, 'bundle.json');
    fs.writeFileSync(
      bundlePath,
      JSON.stringify({
        rulesYaml: yaml.stringify({
          rules: [
            {
              id: 'b_rule_1',
              rule_type: 'expansion',
              trigger_attribute: 'interests',
              trigger_value: 'rope',
              target_attribute: 'interests',
              target_value: 'bondage',
            },
          ],
        }),
        categories: [{ id: 'interests', label: 'Interests', suggestions: ['Rope'] }],
        stickers: ['invalid-array'],
      }),
      'utf8'
    );

    const res = runAnalyzeTaxonomy(
      [
        '--profile',
        'bundled',
        '--provenance',
        'profiles/provenance.json',
        '--bundle',
        bundlePath,
        '--format',
        'json',
      ],
      { repoRoot: tmp }
    );
    expect(res.exitCode).toBe(0);
    expect(res.analysis?.summary.existingRules).toBe(1);
    expect(res.analysis?.summary.existingCategories).toBe(1);
    expect(res.analysis?.summary.existingStickers).toBe(0);
  });
});
