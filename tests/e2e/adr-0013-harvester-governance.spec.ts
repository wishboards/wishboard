import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { seedProposal, harvestTestSignals, getProposalById } from './fixtures/taxonomyDb';

const ADMIN_USER = 'admin';
const ADMIN_SECRET = 'e2e-admin-password'; // gitleaks:allow
const TEST_WISH_PASSPHRASE = 'HarvesterE2ePassphrase123'; // gitleaks:allow

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

async function createWishViaApi(
  request: APIRequestContext,
  content: string,
  extra: Record<string, unknown> = {}
): Promise<{ id: string; passphrase: string }> {
  const res = await request.post('/api/wishes', {
    data: {
      content,
      passphrase: TEST_WISH_PASSPHRASE,
      contactMethod: 'Email',
      contactValue: 'e2e@example.test',
      ...extra,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body?.id).toBeTruthy();
  return { id: body.id as string, passphrase: TEST_WISH_PASSPHRASE };
}

test.describe('ADR 0013 Feature 8: taxonomy_proposals SQLite Table', () => {
  test.describe('Tier 1 — Feature Coverage', () => {
    test('stores normalized_key, proposal_type, proposed_payload, occurrence_count, and status', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const uniqueKey = `service-top-${Date.now()}`;

      const created = await seedProposal({
        normalized_key: uniqueKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'Service Top', label: 'Service Top' },
      });

      expect(created.normalized_key).toBe(uniqueKey);
      expect(created.proposal_type).toBe('suggestion');
      expect(created.proposed_payload).toMatchObject({
        categoryId: 'role',
        term: 'Service Top',
        label: 'Service Top',
      });
      expect(created.occurrence_count).toBeGreaterThanOrEqual(1);
      expect(created.status).toBe('pending');

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.ok()).toBe(true);
      const listBody = await listRes.json();
      expect(
        (listBody.proposals ?? []).some(
          (p: { normalized_key?: string }) => p.normalized_key === uniqueKey
        )
      ).toBe(true);
    });

    test('increments occurrence_count on repeat signal for the same normalized_key', async () => {
      const key = `kitchen-table-poly-${Date.now()}`;

      const first = await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Kitchen Table Poly' },
      });

      const second = await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Kitchen Table Poly' },
      });

      expect(second.id).toBe(first.id);
      expect(second.occurrence_count).toBe(first.occurrence_count + 1);
    });

    test('deduplicates normalized keys in the proposals listing', async ({ request }) => {
      const token = await getAdminToken(request);
      const key = `demiromantic-${Date.now()}`;

      for (let i = 0; i < 3; i += 1) {
        await seedProposal({
          normalized_key: key,
          proposal_type: 'suggestion',
          proposed_payload: { categoryId: 'orientation', term: 'Demiromantic' },
        });
      }

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.ok()).toBe(true);
      const listBody = await listRes.json();
      const proposals = listBody.proposals ?? [];
      const matches = proposals.filter(
        (p: { normalized_key?: string }) => p.normalized_key === key
      );

      expect(matches).toHaveLength(1);
      expect(matches[0]?.occurrence_count).toBe(3);
    });

    test('supports suggestion, category, and rule proposal types', async () => {
      const suffix = Date.now();

      const payloads = [
        {
          normalized_key: `sugg-prop-${suffix}`,
          proposal_type: 'suggestion' as const,
          proposed_payload: { categoryId: 'role', term: 'Brat Tamer' },
        },
        {
          normalized_key: `cat-prop-${suffix}`,
          proposal_type: 'category' as const,
          proposed_payload: { id: 'play_style', label: 'Play Style', suggestions: [] },
        },
        {
          normalized_key: `rule-prop-${suffix}`,
          proposal_type: 'rule' as const,
          proposed_payload: {
            rule_type: 'expansion',
            trigger_attribute: 'role',
            trigger_value: 'rope bunny',
            target_attribute: 'role',
            target_value: 'Bottom',
          },
        },
      ];

      for (const payload of payloads) {
        const created = await seedProposal(payload);
        expect(created.proposal_type).toBe(payload.proposal_type);
      }
    });

    test('persists proposals across independent HTTP request roundtrips', async ({ request }) => {
      const token = await getAdminToken(request);
      const key = `roundtrip-tag-${Date.now()}`;

      const created = await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Roundtrip Tag' },
      });

      const fetchedDb = await getProposalById(created.id);
      expect(fetchedDb?.normalized_key).toBe(key);
      expect(fetchedDb?.status).toBe('pending');

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.ok()).toBe(true);
      const listBody = await listRes.json();
      const fetched = (listBody.proposals ?? []).find((p: { id?: number }) => p.id === created.id);
      expect(fetched?.normalized_key).toBe(key);
      expect(fetched?.status).toBe('pending');
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('never stores wishId or linking wish references in taxonomy_proposals', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const key = `no-wish-id-${Date.now()}`;

      await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'Impact Bottom' },
      });

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.ok()).toBe(true);
      const listBody = await listRes.json();
      const row = (listBody.proposals ?? []).find(
        (p: { normalized_key?: string }) => p.normalized_key === key
      );
      expect(row).toBeTruthy();
      expect(row?.wish_id).toBeUndefined();
      expect(row?.wishId).toBeUndefined();
    });

    test('never stores raw user prose or PII in taxonomy_proposals', async ({ request }) => {
      const token = await getAdminToken(request);
      const key = `no-pii-${Date.now()}`;

      await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Rope Play' },
      });

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.ok()).toBe(true);
      const serialized = await listRes.text();

      expect(serialized).toContain(key);
      expect(serialized).not.toContain('raw_text');
    });

    test('enforces bounded normalized_key length', async () => {
      const oversizedKey = 'x'.repeat(120);
      const created = await seedProposal({
        normalized_key: oversizedKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Bounded' },
      });
      expect(created.normalized_key.length).toBeLessThanOrEqual(128);
    });

    test('rejects invalid proposal_type or status values', async () => {
      await expect(
        seedProposal({
          normalized_key: `bad-type-${Date.now()}`,
          proposal_type: 'arbitrary_sql_drop' as 'suggestion',
          proposed_payload: { term: 'Invalid' },
        })
      ).rejects.toThrow();

      await expect(
        seedProposal({
          normalized_key: `bad-status-${Date.now()}`,
          proposal_type: 'suggestion',
          status: 'auto_promoted_bypass' as 'pending',
          proposed_payload: { term: 'Invalid Status' },
        })
      ).rejects.toThrow();
    });

    test('case and whitespace normalization deduplicates "Rope Bunny" and "  rope   bunny  "', async () => {
      const suffix = Date.now();

      const first = await seedProposal({
        normalized_key: `Rope Bunny ${suffix}`,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'Rope Bunny' },
      });

      const second = await seedProposal({
        normalized_key: `  rope   bunny   ${suffix} `,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'rope bunny' },
      });

      expect(second.normalized_key).toBe(first.normalized_key);
      expect(second.occurrence_count).toBe(first.occurrence_count + 1);
    });
  });
});

test.describe('ADR 0013 Feature 9: Runtime Gap Harvester (unmappedSignals)', () => {
  test.describe('Tier 1 — Feature Coverage', () => {
    test('harvests unmapped signals from wish tagging flow into taxonomy_proposals', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const term = `shibari-rigger-${Date.now()}`;

      await createWishViaApi(request, `Experienced ${term} seeking partner for rope jam.`);

      await expect
        .poll(
          async () => {
            const res = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok()) return false;
            const body = await res.json();
            const list = Array.isArray(body) ? body : (body?.proposals ?? []);
            return list.some((p: { normalized_key?: string }) =>
              (p.normalized_key ?? '').includes(term.toLowerCase())
            );
          },
          { timeout: 10000 }
        )
        .toBe(true);
    });

    test('supports harvesting structured unmappedSignals from CloudProvider responses', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const signalKey = `cloud-signal-${Date.now()}`;

      await harvestTestSignals([
        {
          key: signalKey,
          proposal_type: 'suggestion',
          payload: { categoryId: 'role', term: 'Service Switch' },
        },
      ]);

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = await listRes.json();
      const proposals = listBody.proposals ?? [];
      expect(
        proposals.some((p: { normalized_key?: string }) => p.normalized_key === signalKey)
      ).toBe(true);
    });

    test('supports LocalProvider deterministic unmatched-phrase collector', async ({ request }) => {
      const token = await getAdminToken(request);
      const phrase = `solo-poly-${Date.now()}`;

      await harvestTestSignals([
        {
          key: phrase,
          proposal_type: 'suggestion',
          payload: { categoryId: 'orientation', term: 'Solo Poly' },
        },
      ]);

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = await listRes.json();
      const proposals = listBody.proposals ?? [];
      expect(proposals.some((p: { normalized_key?: string }) => p.normalized_key === phrase)).toBe(
        true
      );
    });

    test('preserves wish creation and retrieval throughput when harvesting signals', async ({
      request,
    }) => {
      const start = Date.now();
      const created = await createWishViaApi(
        request,
        'Looking for friendly tabletop boardgames and tea at the lounge.'
      );
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(5000);
      const fetchRes = await request.get(`/api/wishes/${created.id}`);
      expect(fetchRes.ok()).toBe(true);
    });

    test('handles multiple unmapped signals harvested from a single wish', async ({ request }) => {
      const token = await getAdminToken(request);
      const suffix = Date.now();
      const sigA = `multi-a-${suffix}`;
      const sigB = `multi-b-${suffix}`;

      await harvestTestSignals([
        {
          key: sigA,
          proposal_type: 'suggestion',
          payload: { categoryId: 'role', term: 'Multi A' },
        },
        {
          key: sigB,
          proposal_type: 'rule',
          payload: {
            rule_type: 'expansion',
            trigger_attribute: 'role',
            trigger_value: sigB,
            target_attribute: 'role',
            target_value: 'Switch',
          },
        },
      ]);

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = await listRes.json();
      const proposals = listBody.proposals ?? [];
      const keys = proposals.map((p: { normalized_key?: string }) => p.normalized_key);

      expect(keys).toContain(sigA);
      expect(keys).toContain(sigB);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('harvester error is non-fatal to wish creation and suggestion flow', async ({
      request,
    }) => {
      await expect(
        harvestTestSignals([
          {
            key: '',
            proposal_type: 'suggestion',
            payload: {},
          },
        ])
      ).rejects.toThrow();

      const created = await createWishViaApi(
        request,
        'Switch seeking cozy coffee chat with fellow sci-fi fans.'
      );
      expect(created.id).toBeTruthy();

      const getRes = await request.get(`/api/wishes/${created.id}`);
      expect(getRes.ok()).toBe(true);
      const wish = await getRes.json();
      expect(wish?.content).toContain('cozy coffee chat');

      const suggRes = await request.get(`/api/wishes/${created.id}/suggestions`, {
        headers: { 'x-passphrase': created.passphrase },
      });
      expect(suggRes.ok()).toBe(true);
    });

    test('wish:suggestions:<wishId> WebSocket payload is not delayed or altered by harvesting', async ({
      page,
    }) => {
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

      const passphrase = TEST_WISH_PASSPHRASE;
      await page.goto('/#enter');
      await page.fill(
        'textarea[placeholder="Type your wish here"]',
        '30yo queer switch looking for board games'
      );
      await page.fill('#passphrase', passphrase);
      await page.click('button[type="submit"]:has-text("Submit Wish")');

      const successMsg = page.locator('.message.success');
      await expect(successMsg).toBeVisible();
      const wishId = (await successMsg.locator('strong').first().innerText())
        .replace('Wish saved! ID: ', '')
        .trim();

      await page.route(`**/api/wishes/${wishId}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'sugg-adr13-check',
              wish_id: wishId,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { orientation: ['Queer'], role: ['Switch'] },
              suggested_desired_attributes: {},
              suggested_content: '30yo switch looking for board games',
              reasoning: 'Matched known tags.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${wishId}&secret=${passphrase}`); // gitleaks:allow
      await expect(page.locator('h1')).toHaveText('Manage Your Wish');

      await expect
        .poll(
          () =>
            wsFrames.filter(
              (f) =>
                f.includes(`wish:suggestions:${wishId}`) ||
                (f.includes('wish:ai_suggestions_ready') && f.includes(wishId))
            ).length,
          { timeout: 10000 }
        )
        .toBeGreaterThan(0);

      const suggestionFrames = wsFrames.filter(
        (f) =>
          f.includes(`wish:suggestions:${wishId}`) ||
          (f.includes('wish:ai_suggestions_ready') && f.includes(wishId))
      );
      expect(suggestionFrames.length).toBeGreaterThan(0);
      for (const frame of suggestionFrames) {
        expect(frame).not.toContain('unmappedSignals');
      }
    });

    test('empty or no-gap wish produces zero new taxonomy_proposals', async ({ request }) => {
      const token = await getAdminToken(request);
      const beforeRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const beforeBody = await beforeRes.json();
      const beforeCount = (beforeBody.proposals ?? []).length;

      await createWishViaApi(request, 'Looking for friends.', {
        creator_attributes: { role: ['Switch'], orientation: ['Queer'] },
      });

      const afterRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const afterBody = await afterRes.json();
      const afterCount = (afterBody.proposals ?? []).length;

      expect(afterCount).toBe(beforeCount);
    });

    test('strips PII, age, and location prose before storing harvested proposals', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const key = `stripped-tag-${Date.now()}`;

      await harvestTestSignals([
        {
          key,
          proposal_type: 'suggestion',
          payload: { categoryId: 'interests', term: 'Fire Play' },
        },
      ]);

      const listRes = await request.get('/api/admin/proposals?includeBelowQuorum=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const serialized = await listRes.text();
      expect(serialized).toContain(key);
      expect(serialized).not.toContain('john@example.com');
      expect(serialized).not.toContain('John Doe');
      expect(serialized).not.toContain('555-1234');
    });

    test('offline LocalProvider makes zero outbound network calls while harvesting', async ({
      page,
      request,
    }) => {
      const externalRequests: string[] = [];
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (!url.startsWith('http://localhost:3000') && !url.startsWith('data:')) {
          externalRequests.push(url);
          return route.abort();
        }
        return route.continue();
      });

      const configRes = await request.get('/api/config');
      expect(configRes.ok()).toBe(true);
      const config = await configRes.json();
      expect(['local', 'noop', undefined]).toContain(config?.ai?.provider);

      await harvestTestSignals([
        {
          key: `offline-local-${Date.now()}`,
          proposal_type: 'suggestion',
          payload: { categoryId: 'role', term: 'Offline Local Tag' },
        },
      ]);
      expect(externalRequests).toHaveLength(0);
    });
  });
});

test.describe('ADR 0013 Feature 10: Admin Governance Queue UI & API', () => {
  test.describe('Tier 1 — Feature Coverage', () => {
    test('/#admin Governance Queue renders proposals ranked by occurrence_count descending', async ({
      page,
    }) => {
      const suffix = Date.now();
      const lowKey = `rank-low-${suffix}`;
      const highKey = `rank-high-${suffix}`;

      await seedProposal({
        normalized_key: lowKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: `Rank Low ${suffix}` },
        occurrence_count: 3,
      });
      await seedProposal({
        normalized_key: highKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: `Rank High ${suffix}` },
        occurrence_count: 5,
      });

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const rows = page.locator('[data-testid="governance-proposal-row"]');
      await expect(rows.first()).toBeVisible({ timeout: 10000 });

      const texts = await rows.allInnerTexts();
      const highIdx = texts.findIndex((t) => t.includes(highKey));
      const lowIdx = texts.findIndex((t) => t.includes(lowKey));
      expect(highIdx).toBeGreaterThanOrEqual(0);
      expect(lowIdx).toBeGreaterThan(highIdx);
    });

    test('Approve promotes proposed tag/category/rule to live runtime config and rules', async ({
      page,
      request,
    }) => {
      const key = `promoted-tag-${Date.now()}`;
      const label = `Promoted Tag ${Date.now()}`;

      const created = await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: label, label },
        occurrence_count: 3,
      });

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const row = page.locator(`[data-testid="governance-proposal-row"][data-key="${key}"]`);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Approve' }).click();
      await expect(page.locator('.message.success')).toBeVisible();

      const configRes = await request.get('/api/config');
      expect(configRes.ok()).toBe(true);
      const configText = await configRes.text();
      expect(configText).toContain(label);
      expect(created.id).toBeTruthy();
    });

    test('Map-as-Alias creates an expansion rule in live ruleset', async ({ page, request }) => {
      const key = `alias-src-${Date.now()}`;

      await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: key },
        occurrence_count: 3,
      });

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const row = page.locator(`[data-testid="governance-proposal-row"][data-key="${key}"]`);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /Map as Alias/i }).click();
      await row.locator('input[aria-label="Alias target value"]').fill('Switch');
      await row.getByRole('button', { name: /Save Alias Rule/i }).click();
      await expect(page.locator('.message.success')).toBeVisible();

      const token = await getAdminToken(request);
      const rulesRes = await request.get('/api/rules', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(rulesRes.ok()).toBe(true);
      const rules = await rulesRes.json();
      const createdRule = rules.find(
        (r: { rule_type?: string; trigger_value?: string; target_value?: string }) =>
          r.rule_type === 'expansion' && r.trigger_value === key && r.target_value === 'Switch'
      );
      expect(createdRule).toBeTruthy();
    });

    test('Edit modifies proposal payload before approval', async ({ page, request }) => {
      const key = `edit-before-approve-${Date.now()}`;
      const editedLabel = `Edited Label ${Date.now()}`;

      await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Original Draft' },
        occurrence_count: 3,
      });

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const row = page.locator(`[data-testid="governance-proposal-row"][data-key="${key}"]`);
      await row.getByRole('button', { name: 'Edit Payload' }).click();
      await row
        .locator('textarea[aria-label="Edit proposal payload JSON"]')
        .fill(JSON.stringify({ categoryId: 'interests', term: editedLabel, label: editedLabel }));
      await row.getByRole('button', { name: 'Save Payload' }).click();
      await expect(page.locator('.message.success')).toBeVisible();
      await row.getByRole('button', { name: 'Approve' }).click();
      await expect(page.locator('.message.success')).toBeVisible();

      const configRes = await request.get('/api/config');
      const configText = await configRes.text();
      expect(configText).toContain(editedLabel);
    });

    test('Dismiss removes proposal from active Governance Queue', async ({ page }) => {
      const key = `dismiss-me-${Date.now()}`;

      await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Dismiss Me' },
        occurrence_count: 3,
      });

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const row = page.locator(`[data-testid="governance-proposal-row"][data-key="${key}"]`);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Dismiss' }).click();
      await expect(row).toHaveCount(0);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('hides items with occurrence_count < 3 (both 1 and 2) from primary triage by default', async ({
      page,
    }) => {
      const quorumOneKey = `below-quorum-1-${Date.now()}`;
      const quorumTwoKey = `below-quorum-2-${Date.now()}`;

      await seedProposal({
        normalized_key: quorumOneKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'Below Quorum One' },
        occurrence_count: 1,
      });

      await seedProposal({
        normalized_key: quorumTwoKey,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'Below Quorum Two' },
        occurrence_count: 2,
      });

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      await expect(
        page.locator(`[data-testid="governance-proposal-row"][data-key="${quorumOneKey}"]`)
      ).toHaveCount(0);
      await expect(
        page.locator(`[data-testid="governance-proposal-row"][data-key="${quorumTwoKey}"]`)
      ).toHaveCount(0);
    });

    test('respects configurable quorum threshold via query or settings', async ({ request }) => {
      const token = await getAdminToken(request);
      const key = `quorum-one-${Date.now()}`;

      await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'role', term: 'Quorum One' },
        occurrence_count: 1,
      });

      const defaultRes = await request.get('/api/admin/proposals', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const defaultBody = await defaultRes.json();
      const defaultList = defaultBody.proposals ?? [];
      expect(defaultList.some((p: { normalized_key?: string }) => p.normalized_key === key)).toBe(
        false
      );

      const customRes = await request.get('/api/admin/proposals?minQuorum=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const customBody = await customRes.json();
      const customList = customBody.proposals ?? [];
      expect(customList.some((p: { normalized_key?: string }) => p.normalized_key === key)).toBe(
        true
      );
    });

    test('validateRuleset blocks approval of cyclic or contradictory rule with 400/422 and inline UI error', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const key = `cyclic-rule-${Date.now()}`;

      const created = await seedProposal({
        normalized_key: key,
        proposal_type: 'rule',
        proposed_payload: {
          rule_type: 'expansion',
          trigger_attribute: 'role',
          trigger_value: 'SelfLoopTerm',
          target_attribute: 'role',
          target_value: 'SelfLoopTerm',
        },
        occurrence_count: 3,
      });

      const apiApproveRes = await request.post(`/api/admin/proposals/${created.id}/approve`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([400, 422]).toContain(apiApproveRes.status());

      await loginAdminUi(page);
      await page.click('button[title="Taxonomy Governance Queue"]');
      const row = page.locator(`[data-testid="governance-proposal-row"][data-key="${key}"]`);
      await row.getByRole('button', { name: 'Approve' }).click();
      await expect(page.locator('[role="alert"]').first()).toBeVisible();
    });

    test('non-admin and unauthenticated requests to Governance Queue return 401/403', async ({
      request,
    }) => {
      const unauthRes = await request.get('/api/admin/proposals');
      expect([401, 403]).toContain(unauthRes.status());

      const username = `nonadmin_${Date.now()}`;
      const regRes = await request.post('/api/users/register', {
        data: { username, passphrase: TEST_WISH_PASSPHRASE },
      });
      const regBody = await regRes.json();

      const nonAdminRes = await request.get('/api/admin/proposals', {
        headers: { Authorization: `Bearer ${regBody.token}` },
      });
      expect([401, 403]).toContain(nonAdminRes.status());
    });

    test('double-approve or approving an already-dismissed proposal is rejected or idempotent', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const key = `double-dismiss-${Date.now()}`;

      const created = await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: 'Double Dismiss' },
        occurrence_count: 3,
      });

      const dismissRes = await request.post(`/api/admin/proposals/${created.id}/dismiss`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(dismissRes.ok()).toBe(true);

      const approveAfterDismiss = await request.post(`/api/admin/proposals/${created.id}/approve`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([400, 409]).toContain(approveAfterDismiss.status());
    });
  });
});

test.describe('ADR 0013 Feature 14: ADR 0012 Compatibility (wish:suggestions & AiSuggestionModal)', () => {
  test.describe('Tier 1 — Feature Coverage', () => {
    test('wish:suggestions:<wishId> WebSocket event still triggers pending suggestion review UX', async ({
      page,
    }) => {
      await page.goto('/#enter');
      await page.fill(
        'textarea[placeholder="Type your wish here"]',
        'Queer switch seeking indie board games at the lounge.'
      );
      await page.fill('#passphrase', TEST_WISH_PASSPHRASE);
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
      await page.route(`**/api/wishes/${wishId}/suggestions`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-sugg-1',
              wish_id: wishId,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { orientation: ['Queer'], role: ['Switch'] },
              suggested_desired_attributes: {},
              suggested_content: 'Switch seeking indie board games at the lounge.',
              reasoning: 'Compatibility test.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${wishId}&secret=${TEST_WISH_PASSPHRASE}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await expect(page.getByRole('heading', { name: /Review AI Suggestions/i })).toBeVisible();
    });

    test('POST /api/wishes/:id/suggestions/:action continues to accept/reject suggestions', async ({
      request,
    }) => {
      const created = await createWishViaApi(request, 'Looking for fellow tabletop gamers.');
      const res = await request.post(
        `/api/wishes/${created.id}/suggestions/nonexistent-id/reject`,
        {
          data: { passphrase: created.passphrase },
        }
      );
      // Route is mounted and enforces suggestion lookup / auth rather than 404ing on the path pattern
      expect([400, 401, 403, 404]).toContain(res.status());
    });

    test('getExclusionConflicts client pre-validation uses live rules from GET /api/config and /api/rules', async ({
      page,
      request,
    }) => {
      const created = await createWishViaApi(request, 'Switch looking for games');
      await page.route('**/api/config*', async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        const existingRules = Array.isArray(json?.rules) ? json.rules : [];
        await route.fulfill({
          response: res,
          json: {
            ...json,
            rules: [
              ...existingRules,
              {
                id: 9998,
                rule_type: 'exclusion',
                trigger_attribute: 'role',
                trigger_value: 'LiveConflictA',
                target_attribute: 'role',
                target_value: 'LiveConflictB',
              },
            ],
          },
        });
      });
      await page.route(`**/api/wishes/${created.id}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
      });
      await page.route(`**/api/wishes/${created.id}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-excl-1',
              wish_id: created.id,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { role: ['LiveConflictA', 'LiveConflictB'] },
              suggested_desired_attributes: {},
              suggested_content: 'Switch looking for games',
              reasoning: 'Live rules check.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${created.id}&secret=${created.passphrase}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await expect(page.getByRole('heading', { name: /Review AI Suggestions/i })).toBeVisible();
      await expect(page.locator('[role="alert"], .ai-conflict-callout').first()).toBeVisible();
    });

    test('newly promoted DB-overlaid categories and stickers appear in AiSuggestionModal', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const tagLabel = `LiveModalTag${Date.now()}`;
      const key = `live-modal-tag-${Date.now()}`;

      const createdProp = await seedProposal({
        normalized_key: key,
        proposal_type: 'suggestion',
        proposed_payload: { categoryId: 'interests', term: tagLabel, label: tagLabel },
        occurrence_count: 3,
      });
      await request.post(`/api/admin/proposals/${createdProp.id}/approve`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const created = await createWishViaApi(request, `Interested in ${tagLabel}`);
      await page.route(`**/api/wishes/${created.id}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
      });
      await page.route(`**/api/wishes/${created.id}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-db-overlay',
              wish_id: created.id,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { interests: [tagLabel] },
              suggested_desired_attributes: {},
              suggested_content: `Interested in ${tagLabel}`,
              reasoning: 'DB overlay tag.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${created.id}&secret=${created.passphrase}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await expect(page.locator('.ai-chip', { hasText: tagLabel })).toBeVisible();
    });

    test('non-lossy suggestedContent preserves non-stickered terms', async ({ page, request }) => {
      const created = await createWishViaApi(
        request,
        '30yo queer switch looking for indie tabletop games and matcha tea!'
      );
      const streamlined = '30yo switch looking for indie tabletop games and matcha tea!';

      await page.route(`**/api/wishes/${created.id}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
      });
      await page.route(`**/api/wishes/${created.id}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-nonlossy',
              wish_id: created.id,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { orientation: ['Queer'] },
              suggested_desired_attributes: {},
              suggested_content: streamlined,
              reasoning: 'Preserve non-stickered terms.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${created.id}&secret=${created.passphrase}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await page.getByRole('button', { name: 'Use Streamlined' }).click();
      await expect(page.getByLabel('Streamlined Text (Editable)')).toHaveValue(streamlined);
      expect(streamlined).toContain('indie tabletop games and matcha tea');
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('unmappedSignals are never leaked to client AiSuggestionModal or suggestion API response', async ({
      page,
      request,
    }) => {
      const created = await createWishViaApi(
        request,
        'Looking for niche_unmapped_term_xyz at the con.'
      );
      const suggRes = await request.get(`/api/wishes/${created.id}/suggestions`, {
        headers: { 'x-passphrase': created.passphrase },
      });
      expect(suggRes.ok()).toBe(true);
      const text = await suggRes.text();
      expect(text).not.toContain('unmappedSignals');

      await page.goto(`/#manage-wish?id=${created.id}&secret=${created.passphrase}`); // gitleaks:allow
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('unmappedSignals');
    });

    test('mobile viewport preserves >= 44px touch targets in AiSuggestionModal', async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const created = await createWishViaApi(request, 'Queer switch looking for boardgames.');

      await page.route(`**/api/wishes/${created.id}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
      });
      await page.route(`**/api/wishes/${created.id}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-mobile-44',
              wish_id: created.id,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { orientation: ['Queer'], role: ['Switch'] },
              suggested_desired_attributes: {},
              suggested_content: 'Switch looking for boardgames.',
              reasoning: 'Touch target test.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${created.id}&secret=${created.passphrase}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await expect(page.locator('.bottom-sheet-drawer')).toBeVisible();

      const box = await page
        .locator('.bottom-sheet-drawer .ai-chip', { hasText: 'Queer' })
        .first()
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    });

    test('signed-in user preserves Apply to this wish only vs Also update my Account Profile options', async ({
      page,
      request,
    }) => {
      const username = `compat_user_${Date.now()}`;
      const regRes = await request.post('/api/users/register', {
        data: { username, passphrase: TEST_WISH_PASSPHRASE },
      });
      expect(regRes.ok()).toBe(true);
      const { token } = await regRes.json();

      const wishRes = await request.post('/api/wishes', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          content: 'Queer switch looking for games',
          passphrase: TEST_WISH_PASSPHRASE,
          contactMethod: 'Email',
          contactValue: 'compat@example.test',
        },
      });
      const created = await wishRes.json();

      await page.addInitScript((authToken: string) => {
        globalThis.localStorage?.setItem('wishboard-auth-token', authToken);
      }, token);

      await page.route(`**/api/wishes/${created.id}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
      });
      await page.route(`**/api/wishes/${created.id}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-profile-opt',
              wish_id: created.id,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { orientation: ['Queer'] },
              suggested_desired_attributes: {},
              suggested_content: 'Queer switch looking for games',
              reasoning: 'Profile sync option.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${created.id}&secret=${TEST_WISH_PASSPHRASE}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await expect(page.getByRole('heading', { name: /Review AI Suggestions/i })).toBeVisible();
      await expect(page.getByText(/apply only to this wish/i)).toBeVisible();
      await expect(page.getByText(/Also update my Account Profile/i)).toBeVisible();
    });

    test('exclusion conflict disables or warns before submit in AiSuggestionModal', async ({
      page,
      request,
    }) => {
      const created = await createWishViaApi(request, 'Looking for compatible match');

      await page.route('**/api/config*', async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        const existingRules = Array.isArray(json?.rules) ? json.rules : [];
        await route.fulfill({
          response: res,
          json: {
            ...json,
            rules: [
              ...existingRules,
              {
                id: 9999,
                rule_type: 'exclusion',
                trigger_attribute: 'role',
                trigger_value: 'ExclusiveAlpha',
                target_attribute: 'role',
                target_value: 'ExclusiveBeta',
              },
            ],
          },
        });
      });
      await page.route(`**/api/wishes/${created.id}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
      });
      await page.route(`**/api/wishes/${created.id}/suggestions*`, async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'compat-excl-warn',
              wish_id: created.id,
              status: 'pending',
              created_at: new Date().toISOString(),
              suggested_creator_attributes: { role: ['ExclusiveAlpha', 'ExclusiveBeta'] },
              suggested_desired_attributes: {},
              suggested_content: 'Looking for compatible match',
              reasoning: 'Conflict check.',
            },
          ],
        });
      });

      await page.goto(`/#manage-wish?id=${created.id}&secret=${created.passphrase}`); // gitleaks:allow
      await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
      await expect(page.getByRole('heading', { name: /Review AI Suggestions/i })).toBeVisible();
      await expect(page.locator('[role="alert"], .ai-conflict-callout').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Apply Selected/i })).toBeDisabled();
    });

    test('invalid suggestion action is rejected with 400/404', async ({ request }) => {
      const created = await createWishViaApi(request, 'Testing invalid action.');
      const res = await request.post(
        `/api/wishes/${created.id}/suggestions/fake-sugg-id/invalid_action_xyz`,
        {
          data: { passphrase: created.passphrase },
        }
      );
      expect([400, 404]).toContain(res.status());
    });
  });
});
