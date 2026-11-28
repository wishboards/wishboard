import { test, expect, type Page } from '@playwright/test';

const ORIGINAL = 'Hey all, 30yo queer switch looking for indie tabletop games at the lounge!';
const STREAMLINED = '30yo switch looking for indie tabletop games at the lounge!';

async function createWishAndMockSuggestions(page: Page) {
  const passphrase = 'AiE2ePassphrase123'; // gitleaks:allow
  await page.goto('/#enter');
  await page.fill('textarea[placeholder="Type your wish here"]', ORIGINAL);
  await page.fill('#passphrase', passphrase);
  await page.click('button[type="submit"]:has-text("Submit Wish")');
  const successMsg = page.locator('.message.success');
  await expect(successMsg).toBeVisible();
  const wishId = (await successMsg.locator('strong').first().innerText())
    .replace('Wish saved! ID: ', '')
    .trim();

  // The Manage page reads pending_suggestions_count from the wish payload; inject it
  // since the E2E server runs with AI disabled.
  await page.route(`**/api/wishes/${wishId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, pending_suggestions_count: 1 } });
  });

  let postBody: Record<string, unknown> | null = null;
  await page.route(new RegExp(`/api/wishes/${wishId}/suggestions`), async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      postBody = req.postDataJSON();
      await route.fulfill({
        json: {
          success: true,
          message: 'Suggestion modified successfully.',
          content_updated: true,
        },
      });
      return;
    }
    await route.fulfill({
      json: [
        {
          id: 'e2e-sugg',
          wish_id: wishId,
          status: 'pending',
          created_at: new Date().toISOString(),
          suggested_creator_attributes: { orientation: ['Queer'], role: ['Switch'] },
          suggested_desired_attributes: { role: ['Switch'] },
          suggested_content: STREAMLINED,
          reasoning: 'Mocked AI suggestion for E2E.',
        },
      ],
    });
  });

  await page.goto(`/#manage-wish?id=${wishId}&secret=${passphrase}`); // gitleaks:allow
  await expect(page.locator('h1')).toHaveText('Manage Your Wish');
  return { getPostBody: () => postBody };
}

test.describe('AI suggestion review modal', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('desktop: two-column modal with live preview, opt-in desired chips, and streamlining', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { getPostBody } = await createWishAndMockSuggestions(page);

    await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
    await expect(page.getByRole('heading', { name: /Review AI Suggestions/i })).toBeVisible();
    await expect(page.getByLabel('Live card preview')).toBeVisible();

    // Creator chips default selected; desired chip opt-in unselected
    const chips = page.locator('.ai-chip', { hasText: 'Switch' });
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.last()).toHaveAttribute('aria-pressed', 'false');
    await chips.last().click();
    await expect(page.getByText(/Strict filter active/i)).toBeVisible();

    // Streamlining: default keep original, then use streamlined
    await expect(page.getByRole('button', { name: 'Keep Original' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.getByRole('button', { name: 'Use Streamlined' }).click();
    await expect(page.getByLabel('Streamlined Text (Editable)')).toHaveValue(STREAMLINED);
    await expect(page.getByLabel('Live card preview')).toContainText('30yo switch');

    await page.getByRole('button', { name: /Apply Selected/i }).click();
    await expect(page.getByText(/Card text updated/i)).toBeVisible();
    expect(getPostBody()?.content).toBe(STREAMLINED);
  });

  test('mobile: bottom sheet with collapsible live preview', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createWishAndMockSuggestions(page);

    await page.getByRole('button', { name: /View 1 AI suggestion/i }).click();
    await expect(page.locator('.bottom-sheet-drawer')).toBeVisible();

    const toggle = page.getByRole('button', { name: /Live Card Preview/i });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Touch-friendly chip height
    const box = await page
      .locator('.bottom-sheet-drawer .ai-chip', { hasText: 'Queer' })
      .first()
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
