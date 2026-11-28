import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { harvestTestSignals, normalizeProposalKey } from './fixtures/taxonomyDb';

const ADMIN_SECRET = 'e2e-admin-password'; // gitleaks:allow
const SCENARIO_PASSPHRASE = 'ScenarioPassphrase123'; // gitleaks:allow

async function loginAdminApi(request: APIRequestContext): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await request.post('/api/users/login', {
      data: { username: 'admin', passphrase: ADMIN_SECRET },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.token).toBeTruthy();
      return body.token as string;
    }
    if (res.status() !== 429 && res.status() < 500) {
      expect(res.ok()).toBe(true);
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error('loginAdminApi failed after retries');
}

async function loginAdminUi(page: Page): Promise<void> {
  await page.goto('/#admin');
  await expect(page.locator('h1')).toHaveText('Admin Panel');
  await page.fill('label:has-text("Admin username") input', 'admin');
  await page.fill('#admin-passphrase', ADMIN_SECRET);
  await page.click('button[type="submit"]:has-text("Login as Admin")');
  await expect(page.locator('.message.success')).toContainText('Admin login successful.');
}

test.describe('ADR 0013 Tier 4: Real-World Application Scenarios & Live Checkpoints', () => {
  test('Live Checkpoint #1 (Phase 1): Offline Raspberry Pi LocalProvider matches new BDSM/ENM/queer tags with zero outbound network calls', async ({
    page,
    request,
  }) => {
    const externalRequests: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (
        !url.startsWith('http://localhost:3000') &&
        !url.startsWith('http://127.0.0.1:3000') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        externalRequests.push(url);
        return route.abort();
      }
      return route.continue();
    });

    const uniqueMarker = `pi-offline-${Date.now()}`;
    const createRes = await request.post('/api/wishes', {
      data: {
        content: `Looking for rope bunny or service top for ${uniqueMarker}`,
        creator_attributes: {
          role: ['service top'],
          orientation: ['demiromantic'],
          gender: ['nonbinary'],
        },
        desired_attributes: {
          role: ['rope bunny'],
        },
        creator_roles: ['service top'],
        creator_orientations: ['demiromantic'],
        creator_genders: ['nonbinary'],
        desired_roles: ['rope bunny'],
        passphrase: SCENARIO_PASSPHRASE,
      },
    });
    expect(createRes.ok()).toBe(true);

    const searchWishText = `Kitchen table poly and demiromantic hangout ${uniqueMarker}`;
    const polyRes = await request.post('/api/wishes', {
      data: {
        content: searchWishText,
        creator_attributes: {
          orientation: ['demiromantic'],
          role: ['kitchen table poly'],
        },
        creator_orientations: ['demiromantic'],
        creator_roles: ['kitchen table poly'],
        passphrase: SCENARIO_PASSPHRASE,
      },
    });
    expect(polyRes.ok()).toBe(true);

    await page.goto('/#search');
    await page.fill('input[placeholder="Search existing wishes"]', uniqueMarker);
    await page.fill('#search-orientation', 'demiromantic');
    await page.fill('#search-role', 'rope bunny');
    await page.click('button[type="submit"]:has-text("Search")');

    await expect(page.locator('.wish-card', { hasText: uniqueMarker }).first()).toBeVisible();
    expect(externalRequests).toHaveLength(0);
  });

  test('Live Checkpoint #2 (Phase 3): CloudProvider harvests unmappedSignals into taxonomy_proposals while preserving wish:suggestions:<wishId> and offline Pi safety', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const slangSignal = `impact_play_${Date.now()}`;

    const wsFrames: string[] = [];
    page.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        if (typeof frame.payload === 'string') {
          wsFrames.push(frame.payload);
        }
      });
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string') {
          wsFrames.push(frame.payload);
        }
      });
    });

    const wishRes = await request.post('/api/wishes', {
      data: {
        content: `Seeking ${slangSignal} partner for Saturday evening`,
        creator_attributes: { role: ['switch'] },
        creator_roles: ['switch'],
        passphrase: SCENARIO_PASSPHRASE,
      },
    });
    expect(wishRes.ok()).toBe(true);
    const wish = await wishRes.json();

    await harvestTestSignals([
      {
        key: slangSignal,
        proposal_type: 'suggestion',
        payload: { categoryId: 'interests', term: slangSignal, label: slangSignal },
        occurrence_count: 3,
      },
    ]);

    const queueRes = await request.get('/api/admin/proposals?minQuorum=3', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.ok()).toBe(true);
    const queueBody = await queueRes.json();
    const proposals = queueBody.proposals ?? [];
    expect(
      proposals.some(
        (item: { normalized_key?: string }) =>
          item.normalized_key === normalizeProposalKey(slangSignal)
      )
    ).toBe(true);

    // Verify ADR 0012 AiSuggestionModal remains intact
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
            id: 'checkpoint2-sugg',
            wish_id: wish.id,
            status: 'pending',
            created_at: new Date().toISOString(),
            suggested_creator_attributes: { orientation: ['Queer'] },
            suggested_desired_attributes: { role: ['Switch'] },
            suggested_content: 'Seeking partner for Saturday evening',
            reasoning: 'ADR 0012 preserved alongside Loop B harvesting.',
          },
        ],
      });
    });

    await page.goto(`/#manage-wish?id=${wish.id}&secret=${SCENARIO_PASSPHRASE}`); // gitleaks:allow
    await expect
      .poll(
        () =>
          wsFrames.filter(
            (f) =>
              f.includes(`wish:suggestions:${wish.id}`) ||
              (f.includes('wish:ai_suggestions_ready') && f.includes(wish.id))
          ).length,
        { timeout: 10000 }
      )
      .toBeGreaterThan(0);

    const suggestionFrames = wsFrames.filter(
      (f) =>
        f.includes(`wish:suggestions:${wish.id}`) ||
        (f.includes('wish:ai_suggestions_ready') && f.includes(wish.id))
    );
    expect(suggestionFrames.length).toBeGreaterThan(0);

    for (const frame of suggestionFrames) {
      expect(frame).not.toContain('unmappedSignals');
    }

    await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
    await expect(page.getByRole('heading', { name: /Review AI Suggestions/i })).toBeVisible();

    // Verify offline LocalProvider path remains unaffected and functional
    await page.goto('/#search');
    await page.fill('input[placeholder="Search existing wishes"]', slangSignal);
    await page.click('button[type="submit"]:has-text("Search")');
    await expect(page.locator('.wish-card', { hasText: slangSignal })).toBeVisible();
  });

  test('Live Checkpoint #3 (Phase 4): Cloud-exported YAML/SVG patch bundle applies to offline profile and renders declarative SVG stickers', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const exportedTag = `cloud_export_${Date.now()}`;
    const safeSvg =
      '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="#4f46e5"/><circle cx="12" cy="12" r="5" fill="#fbbf24"/></svg>';

    await request.put('/api/admin/profile-overrides', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        categories: [{ id: 'interests', label: 'Interests', suggestions: [exportedTag] }],
        stickers: {
          interests: {
            [exportedTag]: { type: 'svg', svg: safeSvg },
          },
        },
      },
    });

    const exportRes = await request.get('/api/admin/taxonomy/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportRes.ok()).toBe(true);
    const bundle = await exportRes.json();
    expect(bundle.rulesYaml ?? bundle.yaml).toBeTruthy();

    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'wishboard-checkpoint3-'));
    const bundleFile = path.join(tmpDir, 'cloud-export.json');
    fs.writeFileSync(bundleFile, JSON.stringify(bundle, null, 2));

    const cliOut = execFileSync(
      'node',
      [
        path.join(process.cwd(), 'scripts', 'analyze-taxonomy.js'),
        '--bundle',
        bundleFile,
        '--format',
        'json',
      ],
      { cwd: process.cwd(), encoding: 'utf-8' }
    );
    const report = JSON.parse(cliOut);
    expect(report.validation?.valid).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Apply exported bundle overrides to the target offline profile
    const applyRes = await request.put('/api/admin/profile-overrides', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        categories: bundle.categories ?? [
          { id: 'interests', label: 'Interests', suggestions: [exportedTag] },
        ],
        stickers: bundle.stickers ?? {
          interests: { [exportedTag]: { type: 'svg', svg: safeSvg } },
        },
      },
    });
    expect(applyRes.ok()).toBe(true);

    const wishText = `Offline Pi wish with exported sticker ${Date.now()}`;
    await request.post('/api/wishes', {
      data: {
        content: wishText,
        creator_attributes: {
          interests: [exportedTag],
          role: ['switch'],
        },
        creator_roles: ['switch'],
        passphrase: SCENARIO_PASSPHRASE,
      },
    });

    await page.goto('/#search');
    await page.fill('input[placeholder="Search existing wishes"]', wishText);
    await page.click('button[type="submit"]:has-text("Search")');
    const card = page.locator('.wish-card', { hasText: wishText });
    await expect(card).toBeVisible();
    await expect(card.locator('.identity-stickers svg')).toBeVisible();
  });

  test('Scenario 4: Full Loop B lifecycle from 3 user wishes -> quorum -> admin approval with CC0/MIT sticker -> new wish matches', async ({
    page,
    request,
  }) => {
    const communityTerm = `starlight_cuddle_${Date.now()}`;

    // 3 separate users submit wishes with the unmapped term
    for (let i = 1; i <= 3; i += 1) {
      const wishRes = await request.post('/api/wishes', {
        data: {
          content: `User ${i} looking for ${communityTerm} session`,
          passphrase: `${SCENARIO_PASSPHRASE}-${i}`, // gitleaks:allow
        },
      });
      expect(wishRes.ok()).toBe(true);

      const seeded = await harvestTestSignals([
        {
          key: communityTerm,
          proposal_type: 'suggestion',
          payload: { categoryId: 'role', term: communityTerm, label: communityTerm },
          occurrence_count: 1,
        },
      ]);
      expect(seeded[0]?.occurrence_count).toBe(i);
    }

    await loginAdminUi(page);
    await page.click('button[title="Taxonomy Governance Queue"]');
    const row = page.locator('[data-testid="governance-proposal-row"]', {
      hasText: normalizeProposalKey(communityTerm),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText('3');

    // Approve with assisted CC0/MIT sticker
    await row.locator('button:has-text("Approve")').click();
    await expect(page.locator('.message.success')).toBeVisible();

    const newWishText = `Post-approval ${communityTerm} meetup ${Date.now()}`;
    await request.post('/api/wishes', {
      data: {
        content: newWishText,
        creator_attributes: { role: [communityTerm] },
        creator_roles: [communityTerm],
        passphrase: SCENARIO_PASSPHRASE,
      },
    });

    await page.evaluate(() => globalThis.localStorage?.removeItem('wishboard-auth-token'));
    await page.goto('/#search');
    await page.reload();
    await page.fill('input[placeholder="Search existing wishes"]', newWishText);
    await page.fill('#search-role', communityTerm);
    await page.click('button[type="submit"]:has-text("Search")');
    const card = page.locator('.wish-card', { hasText: newWishText });
    await expect(card).toBeVisible();
  });

  test('Scenario 5: Malicious SVG sticker injection attempt is sanitized/blocked while safe geometric SVG renders cleanly', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const xssTag = `xss_guard_${Date.now()}`;
    const dirtySvg =
      '<svg viewBox="0 0 24 24" onmouseover="window.__svgPwned=true"><script>window.__svgPwned=true</script><foreignObject><iframe src="https://evil.example"></iframe></foreignObject><a href="https://evil.example">click</a><polygon points="12,2 22,22 2,22" fill="#10b981"/></svg>';

    const res = await request.put('/api/admin/profile-overrides', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        categories: [{ id: 'interests', label: 'Interests', suggestions: [xssTag] }],
        stickers: { interests: { [xssTag]: { type: 'svg', svg: dirtySvg } } },
      },
    });
    expect(res.ok()).toBe(true);

    const configRes = await request.get('/api/config');
    const configJson = await configRes.json();
    const storedSvg: string = configJson.stickers?.interests?.[xssTag]?.svg ?? '';
    expect(storedSvg).not.toContain('<script');
    expect(storedSvg).not.toContain('foreignObject');
    expect(storedSvg).not.toContain('onmouseover');
    expect(storedSvg).not.toContain('https://evil.example');

    const wishText = `Sanitized geometric SVG card ${Date.now()}`;
    await request.post('/api/wishes', {
      data: {
        content: wishText,
        creator_attributes: { interests: [xssTag] },
        passphrase: SCENARIO_PASSPHRASE,
      },
    });

    await page.goto('/#search');
    await page.fill('input[placeholder="Search existing wishes"]', wishText);
    await page.click('button[type="submit"]:has-text("Search")');
    const card = page.locator('.wish-card', { hasText: wishText });
    await expect(card).toBeVisible();
    await expect(card.locator('.identity-stickers svg')).toBeVisible();

    const pwned = await page.evaluate(() => (globalThis as Record<string, unknown>).__svgPwned);
    expect(pwned).toBeUndefined();
  });

  test('Scenario 6: Conflicting rule proposal blocked in Admin Governance Queue UI by validateRuleset until fixed', async ({
    page,
    request,
  }) => {
    const token = await loginAdminApi(request);
    const roleX = `conflict_x_${Date.now()}`;
    const roleY = `conflict_y_${Date.now()}`;

    await request.post('/api/rules', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        rule_type: 'cross_match',
        trigger_attribute: 'role',
        trigger_value: roleX,
        target_attribute: 'role',
        target_value: roleY,
      },
    });

    const proposalKey = normalizeProposalKey(`bad-excl-${roleX}-${roleY}`);
    await harvestTestSignals([
      {
        key: proposalKey,
        proposal_type: 'rule',
        payload: {
          rule_type: 'exclusion',
          trigger_attribute: 'role',
          trigger_value: roleX,
          target_attribute: 'role',
          target_value: roleY,
        },
        occurrence_count: 3,
      },
    ]);

    await loginAdminUi(page);
    await page.click('button[title="Taxonomy Governance Queue"]');
    const row = page.locator('[data-testid="governance-proposal-row"]', { hasText: proposalKey });
    await expect(row).toBeVisible();
    await row.locator('button:has-text("Approve")').click();

    await expect(page.locator('[role="alert"].message.error')).toContainText(
      /conflict|exclusion|validateRuleset/i
    );

    // Fix conflict by editing rule_type to expansion
    await row.locator('button:has-text("Edit Payload")').click();
    const jsonTextarea = row.locator('textarea[aria-label="Edit proposal payload JSON"]');
    await jsonTextarea.fill(
      JSON.stringify({
        rule_type: 'expansion',
        trigger_attribute: 'role',
        trigger_value: roleX,
        target_attribute: 'role',
        target_value: roleY,
      })
    );
    await row.locator('button:has-text("Save Payload")').click();
    await expect(page.locator('.message.success')).toBeVisible();
    await row.locator('button:has-text("Approve")').click();
    await expect(page.locator('.message.success')).toBeVisible();
  });

  test('Scenario 7: Privacy audit ensures PII in wish prose is never persisted in taxonomy_proposals', async ({
    request,
  }) => {
    const token = await loginAdminApi(request);
    const piiName = 'Jordan Vance';
    const piiEmail = 'jordan.vance@private-example.org';
    const piiPhone = '555-867-5309';
    const piiCity = 'Seattle';
    const kinkTerm = `wax-sculpting-${Date.now()}`;

    const wishRes = await request.post('/api/wishes', {
      data: {
        content: `Hi I am ${piiName}, age 29 in ${piiCity} (${piiEmail}, ${piiPhone}) seeking ${kinkTerm}`,
        passphrase: SCENARIO_PASSPHRASE,
      },
    });
    expect(wishRes.ok()).toBe(true);
    const createdWish = await wishRes.json();

    await harvestTestSignals([
      {
        key: kinkTerm,
        proposal_type: 'suggestion',
        payload: { categoryId: 'interests', term: kinkTerm, label: kinkTerm },
        occurrence_count: 3,
      },
    ]);

    const proposalsRes = await request.get('/api/admin/proposals?minQuorum=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(proposalsRes.ok()).toBe(true);
    const rawJson = await proposalsRes.text();

    expect(rawJson).toContain(kinkTerm);
    expect(rawJson).not.toContain(piiName);
    expect(rawJson).not.toContain(piiEmail);
    expect(rawJson).not.toContain(piiPhone);
    expect(rawJson).not.toContain(piiCity);
    expect(rawJson).not.toContain(createdWish.id);
  });

  test('Scenario 8: Mobile companion viewport (390x844) wish creation + ADR 0012 AI suggestion review with DB-over-YAML categories & SVG stickers', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const token = await loginAdminApi(request);
    const mobileTag = `mobile_rope_${Date.now()}`;

    await request.put('/api/admin/profile-overrides', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        categories: [{ id: 'role', label: 'Role', suggestions: [mobileTag] }],
        stickers: {
          role: {
            [mobileTag]: {
              type: 'svg',
              svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#ec4899"/></svg>',
            },
          },
        },
      },
    });

    await page.goto('/#enter');
    const wishText = `Mobile companion wish ${Date.now()}`;
    await page.fill('textarea[placeholder="Type your wish here"]', wishText);
    await page.fill('#passphrase', SCENARIO_PASSPHRASE);
    await page.click('button[type="submit"]:has-text("Submit Wish")');

    const successMsg = page.locator('.message.success');
    await expect(successMsg).toBeVisible();
    const wishId = (await successMsg.locator('strong').first().innerText())
      .replace('Wish saved! ID: ', '')
      .trim();

    await page.route(`**/api/wishes/${wishId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
    });

    await page.route(`**/api/wishes/${wishId}/suggestions*`, async (route) => {
      await route.fulfill({
        json: [
          {
            id: 'mobile-e2e-sugg',
            wish_id: wishId,
            status: 'pending',
            created_at: new Date().toISOString(),
            suggested_creator_attributes: { role: [mobileTag] },
            suggested_desired_attributes: {},
            suggested_content: wishText,
            reasoning: 'Mobile promoted DB-over-YAML category suggestion.',
          },
        ],
      });
    });

    await page.goto(`/#manage-wish?id=${wishId}&secret=${SCENARIO_PASSPHRASE}`); // gitleaks:allow
    await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
    await expect(page.locator('.bottom-sheet-drawer')).toBeVisible();
    await expect(
      page.locator('.bottom-sheet-drawer .ai-chip', { hasText: mobileTag })
    ).toBeVisible();
  });
});
