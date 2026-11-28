import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import YAML from 'yaml';
import { seedProposal } from './fixtures/taxonomyDb';

const ADMIN_USER = 'admin';
const ADMIN_SECRET = 'e2e-admin-password'; // gitleaks:allow
const USER_PASSPHRASE = 'StickerE2ePassphrase123'; // gitleaks:allow
const REPO_ROOT = path.resolve(process.cwd());

async function getAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/users/login', {
    data: { username: ADMIN_USER, passphrase: ADMIN_SECRET },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body?.token).toBeTruthy();
  return body.token as string;
}

async function loginAdminUi(page: Page): Promise<void> {
  await page.goto('/#admin');
  await expect(page.locator('h1')).toHaveText('Admin Panel');
  await page.fill('label:has-text("Admin username") input', ADMIN_USER);
  await page.fill('#admin-passphrase', ADMIN_SECRET);
  await page.click('button[type="submit"]:has-text("Login as Admin")');
  await expect(page.locator('.message.success')).toContainText('Admin login successful.');
}

async function seedQuorumProposal(
  _request: APIRequestContext,
  _token: string,
  normalizedKey: string,
  label: string,
  category = 'interests'
): Promise<string> {
  const row = await seedProposal({
    normalized_key: normalizedKey,
    proposal_type: 'suggestion',
    proposed_payload: { categoryId: category, term: label, label },
    occurrence_count: 3,
  });
  return String(row.id);
}

function assertSafeSvgMarkup(svg: string): void {
  const lower = svg.toLowerCase();
  expect(lower).toContain('<svg');
  expect(lower).toContain('viewbox=');
  expect(lower).not.toContain('<script');
  expect(lower).not.toContain('<foreignobject');
  expect(lower).not.toMatch(/\son[a-z]+\s*=/);
  expect(lower).not.toMatch(/url\s*\(\s*['"]?https?:/);
  expect(lower).not.toMatch(/(?:xlink:)?href\s*=\s*['"]?https?:/);
}

test.describe('ADR 0013 Feature 11: Assisted CC0/MIT Sticker Matching & SVG Synthesis', () => {
  test.describe('Tier 1 — Feature Coverage', () => {
    test('auto-matches a proposed tag to a bundled CC0/MIT SVG in /assets/stickers/*.svg', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.post('/api/admin/stickers/match', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: 'Nonbinary', category: 'gender' },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();

      expect(body?.source).toBe('bundled');
      expect(body?.src).toMatch(/^\/assets\/stickers\/.+\.svg$/);
      expect(['CC0-1.0', 'MIT', 'Apache-2.0']).toContain(body?.license);
    });

    test('surfaces candidate sticker preview in Admin Governance Queue UI', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const key = `sticker-preview-${Date.now()}`;
      await seedQuorumProposal(request, token, key, 'Demisexual', 'orientation');

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const row = page.locator(`[data-testid="governance-proposal-row"][data-key="${key}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(
        row.locator('[data-testid="candidate-sticker-preview"], img, svg')
      ).toBeVisible();
    });

    test('falls back to constrained geometric SVG synthesis when no bundled icon matches', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.post('/api/admin/stickers/match', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: `Rope Jam Enthusiast ${Date.now()}`, category: 'interests' },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();

      expect(body?.source).toBe('synthesized');
      expect(typeof body?.svg).toBe('string');
      assertSafeSvgMarkup(body.svg);
    });

    test('synthesized SVG passes strict Phase 2 allowlist sanitizer', async ({ request }) => {
      const token = await getAdminToken(request);
      const res = await request.post('/api/admin/stickers/synthesize', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: 'Tea Lounge', category: 'interests' },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      const svg = body?.svg as string;

      assertSafeSvgMarkup(svg);
      const tagMatches = svg.match(/<([a-zA-Z0-9-]+)/g) ?? [];
      const allowedTags = new Set(['<svg', '<path', '<circle', '<rect', '<polygon', '<line']);
      for (const tag of tagMatches) {
        expect(allowedTags.has(tag.toLowerCase())).toBe(true);
      }
    });

    test('promoted sticker renders on wish card after proposal approval', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const label = `SynthesizedBadge${Date.now()}`;
      const key = `synth_badge_${Date.now()}`;
      const proposalId = await seedQuorumProposal(request, token, key, label, 'interests');

      const approveRes = await request.post(`/api/admin/proposals/${proposalId}/approve`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          sticker: {
            type: 'svg',
            svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#7c3aed"/></svg>',
          },
        },
      });
      expect(approveRes.ok()).toBe(true);

      const wishRes = await request.post('/api/wishes', {
        data: {
          content: `Looking for ${label} friends`,
          passphrase: USER_PASSPHRASE,
          contactMethod: 'Email',
          contactValue: 'sticker@example.test',
          creator_attributes: { interests: [label] },
        },
      });
      expect(wishRes.status()).toBe(201);
      const wish = await wishRes.json();

      await page.goto(`/#manage-wish?id=${wish.id}&secret=${USER_PASSPHRASE}`); // gitleaks:allow
      await expect(page.locator('.wish-card').first()).toBeVisible();
      await expect(
        page.locator('.identity-stickers svg, .identity-stickers img, .sticker-badge').first()
      ).toBeVisible();
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('never selects or references excluded CC BY-NC-SA 4.0 or AGPL assets', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.post('/api/admin/stickers/match', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: 'Pride Flag', category: 'orientation' },
      });
      expect(res.ok()).toBe(true);
      const serialized = await res.text();

      expect(serialized).not.toContain('CC BY-NC-SA');
      expect(serialized).not.toContain('AGPL');
      expect(serialized).not.toContain('microsoft/Pride-flag');
      expect(serialized).not.toContain('ContribuLibre/check-match');
    });

    test('synthesized SVG contains zero <script>, on* handlers, <foreignObject>, or external URLs', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.post('/api/admin/stickers/synthesize', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: 'Geometric Heart', category: 'orientation' },
      });
      expect(res.ok()).toBe(true);
      const { svg } = await res.json();
      assertSafeSvgMarkup(svg);
    });

    test('unknown or nonsense tag fallback produces a safe geometric SVG or null gracefully', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.post('/api/admin/stickers/match', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: 'zzz_unknown_nonsense_999111', category: 'interests' },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      if (body?.svg) {
        assertSafeSvgMarkup(body.svg);
      } else {
        expect(body?.svg === null || body?.src === null).toBe(true);
      }
    });

    test('unauthorized or non-admin user cannot trigger sticker synthesis or promotion', async ({
      request,
    }) => {
      const unauthRes = await request.post('/api/admin/stickers/synthesize', {
        data: { label: 'Unauthorized', category: 'interests' },
      });
      expect([401, 403]).toContain(unauthRes.status());

      const regRes = await request.post('/api/users/register', {
        data: { username: `nonadmin_sticker_${Date.now()}`, passphrase: USER_PASSPHRASE },
      });
      const { token } = await regRes.json();

      const nonAdminRes = await request.post('/api/admin/stickers/synthesize', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: 'NonAdmin', category: 'interests' },
      });
      expect([401, 403]).toContain(nonAdminRes.status());
    });

    test('XSS payload in tag label is escaped or sanitized in synthesized SVG', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const xssLabel = '"><script>alert(1)</script><svg onload="alert(2)">';

      const res = await request.post('/api/admin/stickers/synthesize', {
        headers: { Authorization: `Bearer ${token}` },
        data: { label: xssLabel, category: 'interests' },
      });
      expect(res.ok()).toBe(true);
      const { svg } = await res.json();

      assertSafeSvgMarkup(svg);
      expect(svg).not.toContain('alert(1)');
      expect(svg).not.toContain('alert(2)');
    });
  });
});

test.describe('ADR 0013 Feature 12: Admin YAML/SVG Patch Export', () => {
  test.describe('Tier 1 — Feature Coverage', () => {
    test('Admin UI and API export approved DB overrides as profiles/*-compatible YAML', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();
      expect(typeof body?.profileYaml === 'string' || typeof body?.yaml === 'string').toBe(true);

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      await expect(page.getByRole('button', { name: /Export YAML/i })).toBeVisible();
    });

    test('export includes approved rules, categories, and stickers', async ({ request }) => {
      const token = await getAdminToken(request);
      const label = `ExportableTag${Date.now()}`;
      const key = `exportable_${Date.now()}`;
      const id = await seedQuorumProposal(request, token, key, label, 'interests');

      await request.post(`/api/admin/proposals/${id}/approve`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          sticker: {
            type: 'svg',
            svg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>',
          },
        },
      });

      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();
      const combined = JSON.stringify(body);
      expect(combined).toContain(label);
    });

    test('export bundle includes synthesized or bundled SVG assets', async ({ request }) => {
      const token = await getAdminToken(request);
      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();

      expect(body).toHaveProperty('assets');
      expect(typeof body.assets).toBe('object');
      expect(Object.keys(body.assets).length).toBeGreaterThan(0);
    });

    test('exported rules YAML passes validateRuleset checks without errors', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();

      expect(body.validation.valid).toBe(true);
      expect(body.validation.errors).toHaveLength(0);
    });

    test('export output is deterministic across consecutive requests', async ({ request }) => {
      const token = await getAdminToken(request);
      const res1 = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res2 = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res1.ok()).toBe(true);
      expect(res2.ok()).toBe(true);

      const body1 = await res1.json();
      const body2 = await res2.json();
      expect(body1.rulesYaml).toBeTruthy();
      expect(body1.rulesYaml).toBe(body2.rulesYaml);
      expect(body1.stickersYaml).toBe(body2.stickersYaml);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('export never leaks pending taxonomy_proposals or user PII/wish prose', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const pendingKey = `pending_secret_leak_${Date.now()}`;

      await seedProposal({
        normalized_key: pendingKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Unapproved Pending Item' },
      });

      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const text = await exportRes.text();

      expect(text).not.toContain(pendingKey);
      expect(text).not.toContain('Unapproved Pending Item');
    });

    test('non-admin export request returns 401/403', async ({ request }) => {
      const unauthRes = await request.get('/api/admin/taxonomy/export');
      expect([401, 403]).toContain(unauthRes.status());

      const regRes = await request.post('/api/users/register', {
        data: { username: `nonadmin_export_${Date.now()}`, passphrase: USER_PASSPHRASE },
      });
      const { token } = await regRes.json();

      const nonAdminRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([401, 403]).toContain(nonAdminRes.status());
    });

    test('empty overrides export produces valid minimal/empty patch structure', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const exportRes = await request.get('/api/admin/taxonomy/export?overridesOnly=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();
      expect(body).toHaveProperty('assets');
      expect(body.validation.valid).toBe(true);
      expect(body.validation.errors).toHaveLength(0);
      expect(body.overridesOnly).toBe(true);
    });

    test('all SVG assets included in export bundle pass strict allowlist sanitizer', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();
      const assets = body.assets as Record<string, string>;
      expect(Object.keys(assets).length).toBeGreaterThan(0);

      for (const svgContent of Object.values(assets)) {
        expect(typeof svgContent).toBe('string');
        assertSafeSvgMarkup(svgContent);
      }
    });

    test('exported YAML documents parse cleanly without syntax errors', async ({ request }) => {
      const token = await getAdminToken(request);
      const exportRes = await request.get('/api/admin/taxonomy/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exportRes.ok()).toBe(true);
      const body = await exportRes.json();

      for (const field of ['profileYaml', 'rulesYaml', 'stickersYaml', 'yaml']) {
        if (typeof body?.[field] === 'string' && body[field].trim().length > 0) {
          expect(() => YAML.parse(body[field])).not.toThrow();
        }
      }
    });
  });
});

test.describe('ADR 0013 Feature 13: Documentation & ADR 0013 Tracking Sync', () => {
  const aiDocsPath = path.join(REPO_ROOT, 'docs/src/content/docs/ai-features.md');
  const rulesDocsPath = path.join(REPO_ROOT, 'docs/src/content/docs/matching-rules.md');
  const profilesDocsPath = path.join(REPO_ROOT, 'docs/src/content/docs/event-profiles.md');
  const adr0013Path = path.join(
    REPO_ROOT,
    'docs/src/content/docs/adr/0013-ai-assisted-taxonomy-rule-and-sticker-evolution.md'
  );

  test.describe('Tier 1 — Feature Coverage', () => {
    test('ai-features.md documents ADR 0013 Loop A/B and Admin Governance Queue', () => {
      const content = fs.readFileSync(aiDocsPath, 'utf-8');
      expect(content).toMatch(/Loop A|static.*analyzer/i);
      expect(content).toMatch(/Loop B|taxonomy_proposals|unmappedSignals/i);
      expect(content).toMatch(/Governance Queue/i);
    });

    test('matching-rules.md documents validateRuleset and rule lifecycle', () => {
      const content = fs.readFileSync(rulesDocsPath, 'utf-8');
      expect(content).toContain('validateRuleset');
      expect(content).toMatch(/enrichment|acceptance|expansion|cross_match|exclusion/);
    });

    test('event-profiles.md documents DB-over-YAML overrides and declarative SVG stickers', () => {
      const content = fs.readFileSync(profilesDocsPath, 'utf-8');
      expect(content).toMatch(/DB-over-YAML|override/i);
      expect(content).toMatch(/SVG|sticker/i);
    });

    test('ADR 0013 Status header and Tracking checklist are updated', () => {
      const content = fs.readFileSync(adr0013Path, 'utf-8');
      expect(content).toMatch(/-\s+\*\*Status:\*\*\s+(?:Accepted|Implemented)/);
      expect(content).toContain('## Tracking');
      expect(content).toMatch(/-\s+\[x\]\s+Phase 4/i);
    });

    test('Starlight documentation build (npm --prefix docs run build) passes', () => {
      const output = execSync('npm --prefix docs run build', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      expect(output).toBeTruthy();
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('single-H1 frontmatter guard passes on all ADR 0013 updated docs', () => {
      for (const docPath of [aiDocsPath, rulesDocsPath, profilesDocsPath, adr0013Path]) {
        const raw = fs.readFileSync(docPath, 'utf-8');
        const withoutFrontmatter = raw.replace(/^---[\s\S]*?---\s*/, '');
        const withoutCodeBlocks = withoutFrontmatter.replace(/```[\s\S]*?```/g, '');
        const h1Lines = withoutCodeBlocks.match(/^#\s+.+$/gm) ?? [];
        // Starlight renders frontmatter `title:` as the sole page H1, so body must have 0 H1s
        expect(h1Lines.length).toBe(0);
      }
    });

    test('no broken relative internal links in updated ADR 0013 docs', () => {
      for (const docPath of [aiDocsPath, rulesDocsPath, profilesDocsPath, adr0013Path]) {
        const raw = fs.readFileSync(docPath, 'utf-8');
        expect(raw).not.toMatch(/\]\(\s*\)/);
        expect(raw).not.toContain('undefined');
      }
    });

    test('ADR 0013 license table still explicitly excludes AGPL and CC BY-NC-SA 4.0', () => {
      const content = fs.readFileSync(adr0013Path, 'utf-8');
      expect(content).toContain('AGPL-3.0-or-later');
      expect(content).toContain('CC BY-NC-SA 4.0');
      expect(content).toMatch(/excluded/i);
    });

    test('updated ADR 0013 docs contain valid YAML frontmatter with title', () => {
      for (const docPath of [aiDocsPath, rulesDocsPath, profilesDocsPath, adr0013Path]) {
        const raw = fs.readFileSync(docPath, 'utf-8');
        const match = /^---\n([\s\S]*?)\n---/.exec(raw);
        expect(match).toBeTruthy();
        const parsed = YAML.parse(match?.[1] ?? '');
        expect(typeof parsed?.title).toBe('string');
        expect(parsed.title.length).toBeGreaterThan(0);
      }
    });

    test('no raw secrets or placeholder TODOs in updated ADR 0013 docs', () => {
      for (const docPath of [aiDocsPath, rulesDocsPath, profilesDocsPath, adr0013Path]) {
        const raw = fs.readFileSync(docPath, 'utf-8');
        expect(raw).not.toMatch(/TODO:|FIXME:|sk-[a-zA-Z0-9]{20,}/);
      }
    });
  });
});
