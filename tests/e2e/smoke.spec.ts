import { test, expect } from '@playwright/test';

test.describe('Wishboard E2E Smoke Tests', () => {
  test('should successfully post, search, and admin-manage a wish', async ({ page }) => {
    // 1. Visit Kiosk view / Home page
    await page.goto('/');
    await expect(page.locator('.logo')).toHaveText('Wishboard');

    // 2. Navigate to Enter Wish page
    await page.click('button:has-text("Enter a Wish")');
    await expect(page.locator('h1')).toHaveText('Enter a Wish');

    // Fill in wish content
    const wishText = `E2E Test Wish - Spontaneous road trip ${Date.now()}`;
    await page.fill('textarea[placeholder="Type your wish here"]', wishText);

    // Enter creator identity attributes (simulating anonymous user selections)
    await page.fill(
      'label:has-text("Creator genders") input[type="text"]',
      'non-binary, genderqueer'
    );
    await page.fill('label:has-text("Creator orientations") input[type="text"]', 'queer');
    await page.fill('label:has-text("Creator roles") input[type="text"]', 'switch');

    // Submit the wish
    await page.click('button[type="submit"]:has-text("Submit Wish")');

    // 3. Verify success message and retrieve passphrase
    const successMsg = page.locator('.message.success');
    await expect(successMsg).toBeVisible();
    await expect(successMsg).toContainText('Wish saved!');

    const passphraseElement = successMsg.locator('strong').nth(1);
    const passphrase = await passphraseElement.innerText();
    expect(passphrase.length).toBeGreaterThan(0);

    // 4. Navigate to Search Wishes page
    await page.click('header nav button:has-text("Search Wishes")');
    await expect(page.locator('h1')).toHaveText('Search Wishes');

    // Enter search query
    await page.fill('input[placeholder="Search existing wishes"]', 'Spontaneous road trip');

    // Set search user attributes so matching rules show the wish
    await page.fill('#search-gender', 'non-binary');
    await page.fill('#search-orientation', 'queer');
    await page.fill('#search-role', 'switch');

    await page.click('button[type="submit"]:has-text("Search")');

    // Verify search results contain our wish
    const wishCard = page.locator('.wish-card', { hasText: wishText });
    await expect(wishCard).toBeVisible();

    // --- Layout & Rendering Checks (Resolving #134 backlog criteria) ---
    const innerScale = wishCard.locator('.wish-card-inner-scale');
    const wishTextEl = wishCard.locator('.wish-text');
    const stickers = wishCard.locator('.identity-stickers');
    const topActions = wishCard.locator('.card-top-left-actions');

    const innerScaleBox = await innerScale.boundingBox();
    const wishTextBox = await wishTextEl.boundingBox();
    const stickersBox = await stickers.boundingBox();
    const topActionsBox = await topActions.boundingBox();

    expect(innerScaleBox).not.toBeNull();
    expect(wishTextBox).not.toBeNull();
    expect(stickersBox).not.toBeNull();
    expect(topActionsBox).not.toBeNull();

    if (innerScaleBox && wishTextBox && stickersBox && topActionsBox) {
      // 1. Text fits within the scale wrapper (doesn't escape bottom)
      expect(wishTextBox.y + wishTextBox.height).toBeLessThanOrEqual(
        innerScaleBox.y + innerScaleBox.height + 1 // allow 1px rounding offset
      );

      // 2. Floats do not have negative top margins that push them above the card boundaries (no clipping by overflow: hidden)
      expect(stickersBox.y).toBeGreaterThanOrEqual(innerScaleBox.y - 1);
      expect(topActionsBox.y).toBeGreaterThanOrEqual(innerScaleBox.y - 1);

      // 3. Stickers container is display: flex/inline-flex to tightly wrap its content (not block inline-height descent)
      const displayValue = await stickers.evaluate((el) => getComputedStyle(el).display);
      expect(['flex', 'inline-flex']).toContain(displayValue);
    }

    // 5. Navigate to Admin Panel and login
    await page.click('button:has-text("Admin")');
    await expect(page.locator('h1')).toHaveText('Admin Panel');

    // Log in
    await page.fill('label:has-text("Admin username") input', 'admin');
    await page.fill('#admin-passphrase', 'e2e-admin-password');
    await page.click('button[type="submit"]:has-text("Login as Admin")');

    // Verify admin dashboard tabs
    await expect(page.locator('.message.success')).toContainText('Admin login successful.');
    await expect(page.locator('button[title="System Overview"]')).toBeVisible();

    // Navigate to System Overview tab
    await page.click('button[title="System Overview"]');
    await expect(page.locator('h2:has-text("System Metrics")')).toBeVisible();

    // Log out from admin
    await page.click('button:has-text("Log out")');
    await expect(page.locator('button[type="submit"]:has-text("Login as Admin")')).toBeVisible();
  });
});
