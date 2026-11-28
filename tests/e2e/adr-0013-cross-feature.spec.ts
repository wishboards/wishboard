import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { harvestTestSignals, normalizeProposalKey } from './fixtures/taxonomyDb';

const ADMIN_SECRET = 'e2e-admin-password'; // gitleaks:allow
const USER_PASSPHRASE = 'CrossFeaturePassphrase123'; // gitleaks:allow

async function loginAdminApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/users/login', {
    data: { username: 'admin', passphrase: ADMIN_SECRET },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

async function loginAdminUi(page: Page): Promise<void> {
  await page.goto('/#admin');
  await expect(page.locator('h1')).toHaveText('Admin Panel');
  await page.fill('label:has-text("Admin username") input', 'admin');
  await page.fill('#admin-passphrase', ADMIN_SECRET);
  await page.click('button[type="submit"]:has-text("Login as Admin")');
  await expect(page.locator('.message.success')).toContainText('Admin login successful.');
}

async function createWishViaApi(
  request: APIRequestContext,
  payload: {
    content: string;
    creatorAttributes?: Record<string, string[]>;
    desiredAttributes?: Record<string, string[]>;
  }
): Promise<{ id: string; passphrase: string }> {
  const res = await request.post('/api/wishes', {
    data: {
      content: payload.content,
      creator_attributes: payload.creatorAttributes,
      desired_attributes: payload.desiredAttributes,
      creator_genders: payload.creatorAttributes?.gender,
      creator_orientations: payload.creatorAttributes?.orientation,
      creator_roles: payload.creatorAttributes?.role,
      desired_genders: payload.desiredAttributes?.gender,
      desired_orientations: payload.desiredAttributes?.orientation,
      desired_roles: payload.desiredAttributes?.role,
      passphrase: USER_PASSPHRASE,
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  return { id: body.id as string, passphrase: USER_PASSPHRASE };
}

test.describe('ADR 0013 Tier 3: Cross-Feature Pairwise Combinations', () => {
  test('F1 + F3 + F4: validateRuleset + analyze-taxonomy CLI + profiles/lifestyle pass validation', async () => {
    const repoRoot = process.cwd();
    const analyzerPath = path.join(repoRoot, 'scripts', 'analyze-taxonomy.js');
    expect(fs.existsSync(analyzerPath)).toBe(true);

    const stdout = execFileSync(
      'node',
      [analyzerPath, '--profile', 'lifestyle', '--format', 'json'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    );

    const report = JSON.parse(stdout);
    expect(report.profile).toBe('lifestyle');
    expect(report.validation?.valid).toBe(true);
    expect(report.validation?.errors ?? []).toHaveLength(0);
    expect(report.summary?.existingCategories).toBeGreaterThan(0);
    expect(report.summary?.existingRules).toBeGreaterThan(0);
  });

  test('F2 + F11: License & Provenance Manifest restricts assisted sticker matching to CC0-1.0/MIT', async ({
    request,
  }) => {
    const repoRoot = process.cwd();
    const manifestCandidates = [
      path.join(repoRoot, 'profiles', 'provenance.json'),
      path.join(repoRoot, 'profiles', 'lifestyle', 'provenance.json'),
      path.join(repoRoot, 'scripts', 'taxonomy-provenance.json'),
    ];
    const manifestPath = manifestCandidates.find((candidate) => fs.existsSync(candidate));
    expect(manifestPath).toBeTruthy();

    const manifest = JSON.parse(fs.readFileSync(manifestPath as string, 'utf-8'));
    const approvedLicenses = new Set(['Apache-2.0', 'MIT', 'CC0-1.0']);
    const blockedSources = new Set(['ContribuLibre/check-match', 'microsoft/Pride-flag']);

    for (const entry of manifest.approvedSources ?? []) {
      expect(approvedLicenses.has(entry.license)).toBe(true);
    }
    const excludedList = manifest.excludedSources ?? [];
    for (const blocked of blockedSources) {
      expect(
        excludedList.some((e: { source?: string }) => e.source === blocked) ||
          (manifest.sources ?? []).some(
            (e: { name?: string; status?: string }) => e.name === blocked && e.status === 'excluded'
          )
      ).toBe(true);
    }

    const token = await loginAdminApi(request);
    const matchRes = await request.post('/api/admin/stickers/match', {
      headers: { Authorization: `Bearer ${token}` },
      data: { tag: 'demiromantic', category: 'orientation' },
    });
    expect(matchRes.ok()).toBe(true);
    const matchBody = await matchRes.json();
    expect(['CC0-1.0', 'MIT']).toContain(matchBody.license);
    expect(matchBody.sticker?.type).toMatch(/^(image|svg)$/);
  });

  test('F5 + F6 + F7: Strict SVG Sanitizer strips XSS on DB-over-YAML declarative stickers rendered on cards', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const uniqueTag = `safegeo_${Date.now()}`;
    const maliciousSvg =
      '<svg viewBox="0 0 24 24" onload="alert(1)"><script>window.__xss=1</script><foreignObject><div>bad</div></foreignObject><circle cx="12" cy="12" r="8" fill="#6b5ce7" onclick="alert(2)"/><path d="M4 12 L20 12" stroke="#ffffff"/></svg>';

    const overrideRes = await request.put('/api/admin/profile-overrides', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        categories: [{ id: 'interests', label: 'Interests', suggestions: [uniqueTag] }],
        stickers: {
          interests: {
            [uniqueTag]: {
              type: 'svg',
              svg: maliciousSvg,
            },
          },
        },
      },
    });
    expect(overrideRes.ok()).toBe(true);

    const wishText = `Sanitized declarative sticker wish ${Date.now()}`;
    await createWishViaApi(request, {
      content: wishText,
      creatorAttributes: {
        interests: [uniqueTag],
        role: ['switch'],
        gender: ['nonbinary'],
      },
    });

    const configRes = await request.get('/api/config');
    expect(configRes.ok()).toBe(true);
    const configJson = await configRes.json();
    const persistedSvg: string = configJson.stickers?.interests?.[uniqueTag]?.svg ?? '';
    expect(persistedSvg).toContain('<svg');
    expect(persistedSvg).toContain('<circle');
    expect(persistedSvg).not.toContain('<script');
    expect(persistedSvg).not.toContain('onload');
    expect(persistedSvg).not.toContain('onclick');
    expect(persistedSvg).not.toContain('foreignObject');

    await page.goto('/#search');
    await page.fill('input[placeholder="Search existing wishes"]', wishText);
    await page.click('button[type="submit"]:has-text("Search")');
    const card = page.locator('.wish-card', { hasText: wishText });
    await expect(card).toBeVisible();
    await expect(card.locator('.identity-stickers')).toBeVisible();
    await expect(card.locator('.identity-stickers svg')).toBeVisible();

    const xssFlag = await page.evaluate(() => (globalThis as Record<string, unknown>).__xss);
    expect(xssFlag).toBeUndefined();
  });

  test('F8 + F9 + F10: Runtime Gap Harvester aggregates quorum >= 3 without PII into Admin Governance Queue', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const slangTerm = `fire-spinner-${Date.now()}`;

    await harvestTestSignals([
      {
        key: slangTerm,
        proposal_type: 'suggestion',
        payload: { categoryId: 'interests', term: slangTerm, label: slangTerm },
        occurrence_count: 3,
      },
    ]);

    const listRes = await request.get('/api/admin/proposals?minQuorum=3', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBe(true);
    const listBody = await listRes.json();
    const proposals = listBody.proposals ?? [];
    const found = proposals.find(
      (item: { normalized_key?: string }) => item.normalized_key === normalizeProposalKey(slangTerm)
    );
    expect(found).toBeTruthy();
    expect(found.occurrence_count).toBeGreaterThanOrEqual(3);
    expect(found.wish_id).toBeUndefined();
    expect(found.raw_content).toBeUndefined();

    await loginAdminUi(page);
    await page.click('button[title="Taxonomy Governance Queue"]');
    await expect(
      page.locator(`[data-testid="governance-proposal-row"][data-key="${slangTerm}"]`)
    ).toContainText(slangTerm);
  });

  test('F1 + F10: Admin Governance Queue validateRuleset gate blocks conflicts and expansion cycles and promotes valid rules within TTL', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const termA = `gate_a_${Date.now()}`;
    const termB = `gate_b_${Date.now()}`;

    const seedRuleRes = await request.post('/api/rules', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rule_type: 'cross_match',
        trigger_attribute: 'role',
        trigger_value: termA,
        target_attribute: 'role',
        target_value: termB,
      },
    });
    expect(seedRuleRes.ok()).toBe(true);

    // 1. Harvest a conflicting exclusion proposal
    const conflictKey = normalizeProposalKey(`conflict-${termA}-${termB}`);
    await harvestTestSignals([
      {
        key: conflictKey,
        proposal_type: 'rule',
        payload: {
          rule_type: 'exclusion',
          trigger_attribute: 'role',
          trigger_value: termA,
          target_attribute: 'role',
          target_value: termB,
        },
        occurrence_count: 3,
      },
    ]);

    // 2. Harvest an expansion self-loop / cycle proposal (A -> A and A -> B -> A)
    const cycleA = `cycle_a_${Date.now()}`;
    const cycleB = `cycle_b_${Date.now()}`;
    await request.post('/api/rules', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rule_type: 'expansion',
        trigger_attribute: 'role',
        trigger_value: cycleA,
        target_attribute: 'role',
        target_value: cycleB,
      },
    });

    const cycleKey = normalizeProposalKey(`cycle-${cycleB}-${cycleA}`);
    await harvestTestSignals([
      {
        key: cycleKey,
        proposal_type: 'rule',
        payload: {
          rule_type: 'expansion',
          trigger_attribute: 'role',
          trigger_value: cycleB,
          target_attribute: 'role',
          target_value: cycleA,
        },
        occurrence_count: 3,
      },
    ]);

    await loginAdminUi(page);
    await page.click('button[title="Taxonomy Governance Queue"]');

    // Verify exclusion contradiction is blocked
    const conflictRow = page.locator('[data-testid="governance-proposal-row"]', {
      hasText: conflictKey,
    });
    await expect(conflictRow).toBeVisible();
    await conflictRow.locator('button:has-text("Approve")').click();
    await expect(page.locator('[role="alert"].message.error')).toContainText(
      /conflict|exclusion|validateRuleset/i
    );

    // Verify expansion cycle (A -> B -> A) is blocked
    const cycleRow = page.locator('[data-testid="governance-proposal-row"]', {
      hasText: cycleKey,
    });
    await expect(cycleRow).toBeVisible();
    await cycleRow.locator('button:has-text("Approve")').click();
    await expect(page.locator('.message.error')).toContainText(/cycle|loop|validateRuleset/i);

    // 3. Valid rule proposal succeeds and is immediately active in /api/rules (TTL invalidated)
    const validKey = `valid-exp-${Date.now()}`;
    await harvestTestSignals([
      {
        key: validKey,
        proposal_type: 'rule',
        payload: {
          rule_type: 'expansion',
          trigger_attribute: 'role',
          trigger_value: validKey,
          target_attribute: 'role',
          target_value: 'switch',
        },
        occurrence_count: 3,
      },
    ]);

    await page.reload();
    await page.click('button[title="Taxonomy Governance Queue"]');
    const validRow = page.locator('[data-testid="governance-proposal-row"]', {
      hasText: validKey,
    });
    await expect(validRow).toBeVisible();
    await validRow.locator('button:has-text("Approve")').click();
    await expect(page.locator('.message.success')).toBeVisible();

    const rulesRes = await request.get('/api/rules', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(rulesRes.ok()).toBe(true);
    const rules = await rulesRes.json();
    expect(rules.some((r: { trigger_value?: string }) => r.trigger_value === validKey)).toBe(true);
  });

  test('F7 + F10 + F14: Governance approval writes DB-over-YAML override surfaced in AiSuggestionModal', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const promotedTag = `acropartner-${Date.now()}`;

    await harvestTestSignals([
      {
        key: promotedTag,
        proposal_type: 'suggestion',
        payload: { categoryId: 'role', term: promotedTag, label: promotedTag },
        occurrence_count: 3,
      },
    ]);

    const listRes = await request.get('/api/admin/proposals?minQuorum=3', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const proposals = listBody.proposals ?? [];
    const proposal = proposals.find(
      (item: { normalized_key?: string }) => item.normalized_key === promotedTag
    );
    expect(proposal).toBeTruthy();

    const approveRes = await request.post(`/api/admin/proposals/${proposal.id}/approve`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { payloadOverride: { categoryId: 'role', term: promotedTag } },
    });
    expect(approveRes.ok()).toBe(true);

    const configRes = await request.get('/api/config');
    const configJson = await configRes.json();
    const roleCat = configJson.categories?.find((c: { id: string }) => c.id === 'role');
    expect(roleCat?.suggestions ?? []).toContain(promotedTag);

    const wish = await createWishViaApi(request, {
      content: `Looking for ${promotedTag} partner at the workshop`,
    });

    await page.route(`**/api/wishes/${wish.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
    });

    await page.route(`**/api/wishes/${wish.id}/suggestions`, async (route) => {
      await route.fulfill({
        json: [
          {
            id: 'e2e-promoted-sugg',
            wish_id: wish.id,
            status: 'pending',
            created_at: new Date().toISOString(),
            suggested_creator_attributes: { role: [promotedTag] },
            suggested_desired_attributes: {},
            suggested_content: `Looking for ${promotedTag} partner`,
            reasoning: 'Promoted DB-over-YAML taxonomy term.',
          },
        ],
      });
    });

    await page.goto(`/#manage-wish?id=${wish.id}&secret=${wish.passphrase}`); // gitleaks:allow
    await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
    await expect(page.locator('.ai-chip', { hasText: promotedTag })).toBeVisible();
  });

  test('F5 + F6 + F11: Assisted SVG synthesis produces allowlisted geometric SVG rendered on wish cards', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const customTag = `synth_badge_${Date.now()}`;

    const synthRes = await request.post('/api/admin/stickers/synthesize', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        tag: customTag,
        category: 'interests',
      },
    });
    expect(synthRes.ok()).toBe(true);
    const synthBody = await synthRes.json();
    expect(synthBody.sticker?.type).toBe('svg');
    const svg: string = synthBody.sticker?.svg ?? '';
    expect(svg).toMatch(/^<svg[^>]*viewBox=/i);
    expect(svg).not.toMatch(/<script|foreignObject|onload=|onclick=|href=["']https?:/i);

    await request.put('/api/admin/profile-overrides', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        categories: [{ id: 'interests', label: 'Interests', suggestions: [customTag] }],
        stickers: { interests: { [customTag]: synthBody.sticker } },
      },
    });

    const wishText = `Synthesized badge card ${Date.now()}`;
    await createWishViaApi(request, {
      content: wishText,
      creatorAttributes: {
        interests: [customTag],
        role: ['switch'],
      },
    });

    await page.goto('/#search');
    await page.fill('input[placeholder="Search existing wishes"]', wishText);
    await page.click('button[type="submit"]:has-text("Search")');
    const card = page.locator('.wish-card', { hasText: wishText });
    await expect(card).toBeVisible();
    await expect(card.locator('.identity-stickers svg')).toBeVisible();
  });

  test('F1 + F4 + F12: Admin YAML/SVG Patch Export produces bundle validated by analyze-taxonomy CLI', async ({
    request,
  }) => {
    const token = await loginAdminApi(request);
    const exportRes = await request.get('/api/admin/taxonomy/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportRes.ok()).toBe(true);
    const exportPayload = await exportRes.json();
    expect(exportPayload.rulesYaml ?? exportPayload.yaml).toBeTruthy();

    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'wishboard-export-'));
    const bundlePath = path.join(tmpDir, 'patch-bundle.json');
    fs.writeFileSync(bundlePath, JSON.stringify(exportPayload, null, 2));

    const stdout = execFileSync(
      'node',
      [
        path.join(process.cwd(), 'scripts', 'analyze-taxonomy.js'),
        '--bundle',
        bundlePath,
        '--format',
        'json',
      ],
      { cwd: process.cwd(), encoding: 'utf-8' }
    );
    const report = JSON.parse(stdout);
    expect(report.validation?.valid).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('F9 + F14: ADR 0012 wish:suggestions:<wishId> WebSocket stays clean while unmappedSignals harvest', async ({
    page,
    request,
  }) => {
    const wsPayloads: string[] = [];
    page.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        if (typeof frame.payload === 'string') {
          wsPayloads.push(frame.payload);
        }
      });
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string') {
          wsPayloads.push(frame.payload);
        }
      });
    });
    page.on('response', async (res) => {
      if (res.url().includes('/socket.io/')) {
        try {
          wsPayloads.push(await res.text());
        } catch {
          // Ignore aborted/redirected polling responses
        }
      }
    });

    const wish = await createWishViaApi(request, {
      content: `Looking for rope bunny and switch play at dusk ${Date.now()}`,
    });

    await page.goto(`/#manage-wish?id=${wish.id}&secret=${wish.passphrase}`); // gitleaks:allow
    await expect(page.locator('h1')).toHaveText('Manage Your Wish');

    await expect
      .poll(
        async () => {
          const wsHits = wsPayloads.filter(
            (p) =>
              p.includes(`wish:suggestions:${wish.id}`) ||
              (p.includes('wish:ai_suggestions_ready') && p.includes(wish.id))
          ).length;
          if (wsHits > 0) return true;
          const res = await request.get(`/api/wishes/${wish.id}/suggestions`, {
            headers: { 'x-wish-secret': wish.passphrase },
          });
          if (!res.ok()) return false;
          const data = await res.json();
          return Array.isArray(data.suggestions) && data.suggestions.length > 0;
        },
        { timeout: 10000 }
      )
      .toBe(true);

    const suggRes = await request.get(`/api/wishes/${wish.id}/suggestions`, {
      headers: { 'x-wish-secret': wish.passphrase },
    });
    expect(suggRes.ok()).toBe(true);
    expect(await suggRes.text()).not.toContain('unmappedSignals');

    for (const payload of wsPayloads) {
      expect(payload).not.toContain('unmappedSignals');
    }
  });

  test('F7 + F10 + F14: Exclusion conflict check in AiSuggestionModal detects newly promoted DB exclusion rule', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const exclA = `excl_src_${Date.now()}`;
    const exclB = `excl_dst_${Date.now()}`;

    const ruleRes = await request.post('/api/rules', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rule_type: 'exclusion',
        trigger_attribute: 'role',
        trigger_value: exclA,
        target_attribute: 'role',
        target_value: exclB,
      },
    });
    expect(ruleRes.ok()).toBe(true);

    const conflictCheckRes = await request.post('/api/rules/check-conflicts', {
      data: {
        attributes: {
          role: [exclA, exclB],
        },
      },
    });
    expect(conflictCheckRes.ok()).toBe(true);
    const conflictJson = await conflictCheckRes.json();
    expect(Array.isArray(conflictJson.conflicts)).toBe(true);
    expect(conflictJson.conflicts.length).toBeGreaterThan(0);

    const wish = await createWishViaApi(request, {
      content: `Testing exclusion conflict modal ${Date.now()}`,
    });

    await page.route(`**/api/wishes/${wish.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
    });

    await page.route(`**/api/wishes/${wish.id}/suggestions*`, async (route) => {
      await route.fulfill({
        json: [
          {
            id: 'e2e-excl-sugg',
            wish_id: wish.id,
            status: 'pending',
            created_at: new Date().toISOString(),
            suggested_creator_attributes: { role: [exclA, exclB] },
            suggested_desired_attributes: {},
            suggested_content: 'Testing exclusion conflict modal',
            reasoning: 'Exclusion check test.',
          },
        ],
      });
    });

    await page.goto(`/#manage-wish?id=${wish.id}&secret=${wish.passphrase}`); // gitleaks:allow
    await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
    await expect(page.locator('[role="alert"], .ai-conflict-callout').first()).toBeVisible();
  });

  test('F8 + F9 + F10: Proposals with occurrence_count < 3 stay hidden from default quorum triage until 3rd signal', async ({
    request,
  }) => {
    const token = await loginAdminApi(request);
    const rareTerm = `rare-quorum-${Date.now()}`;

    await harvestTestSignals([
      {
        key: rareTerm,
        proposal_type: 'suggestion',
        payload: { categoryId: 'interests', term: rareTerm, label: rareTerm },
        occurrence_count: 2,
      },
    ]);

    const beforeRes = await request.get('/api/admin/proposals?minQuorum=3', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(beforeRes.ok()).toBe(true);
    const beforeBody = await beforeRes.json();
    const beforeList = beforeBody.proposals ?? [];
    expect(beforeList.some((p: { normalized_key?: string }) => p.normalized_key === rareTerm)).toBe(
      false
    );

    await harvestTestSignals([
      {
        key: rareTerm,
        proposal_type: 'suggestion',
        payload: { categoryId: 'interests', term: rareTerm, label: rareTerm },
        occurrence_count: 1,
      },
    ]);

    const afterRes = await request.get('/api/admin/proposals?minQuorum=3', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterBody = await afterRes.json();
    const afterList = afterBody.proposals ?? [];
    const promoted = afterList.find(
      (p: { normalized_key?: string }) => p.normalized_key === rareTerm
    );
    expect(promoted).toBeTruthy();
    expect(promoted.occurrence_count).toBe(3);
  });

  test('F2 + F13: ADR 0013 documentation and license provenance manifest remain synchronized', async () => {
    const repoRoot = process.cwd();
    const adrPath = path.join(
      repoRoot,
      'docs',
      'src',
      'content',
      'docs',
      'adr',
      '0013-ai-assisted-taxonomy-rule-and-sticker-evolution.md'
    );
    const adrContent = fs.readFileSync(adrPath, 'utf-8');

    expect(adrContent).toContain('Apache-2.0');
    expect(adrContent).toContain('MIT');
    expect(adrContent).toContain('CC0-1.0');
    expect(adrContent).toContain('AGPL-3.0-or-later');
    expect(adrContent).toContain('CC BY-NC-SA 4.0');
    expect(adrContent).toMatch(/validateRuleset|Rule Graph Validator/);

    const astroBin = path.join(repoRoot, 'docs', 'node_modules', '.bin', 'astro');
    if (fs.existsSync(astroBin)) {
      const docsBuildOutput = execFileSync('npm', ['--prefix', 'docs', 'run', 'build'], {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      expect(docsBuildOutput).toBeTruthy();
    } else {
      const docsPkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'docs', 'package.json'), 'utf-8')
      );
      expect(docsPkg.scripts?.build).toContain('astro build');
      expect(fs.existsSync(path.join(repoRoot, 'docs', 'astro.config.mjs'))).toBe(true);
    }
  });
});
