import { test, expect } from '@playwright/test';

test.describe('Wish Flagging & Admin Moderation E2E Tests', () => {
  test('should flag a wish from search and manage it from admin flagged tab', async ({ page }) => {
    const timestamp = Date.now();
    const wishText = `Flagged test wish content ${timestamp}`;

    // 1. Create a wish
    await page.goto('/');
    await page.click('button:has-text("Enter a Wish")');
    await page.fill('textarea[placeholder="Type your wish here"]', wishText);
    await page.click('button[type="submit"]:has-text("Submit Wish")');
    await expect(page.locator('.message.success')).toBeVisible();

    // 2. Search for the wish
    await page.click('button:has-text("Search Wishes")');
    await page.fill(
      'input[placeholder="Search existing wishes"]',
      `Flagged test wish content ${timestamp}`
    );
    await page.click('button[type="submit"]:has-text("Search")');

    const wishCard = page.locator('.wish-card', { hasText: wishText });
    await expect(wishCard).toBeVisible();

    // 3. Flag the wish
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('flag this wish');
      await dialog.accept();
    });
    await wishCard.locator('.flag-wish-btn').click();

    // After flagging, card should disappear from search
    await expect(wishCard).not.toBeVisible();

    // 4. Admin log in
    await page.click('button:has-text("Admin")');
    await page.fill('label:has-text("Admin username") input', 'admin');
    await page.fill('#admin-passphrase', 'e2e-admin-password');
    await page.click('button[type="submit"]:has-text("Login as Admin")');

    // 5. Navigate to Flagged Wishes tab
    await page.click('button[title="Flagged Wishes"]');
    await expect(page.locator('h2:has-text("Flagged Wishes")')).toBeVisible();

    const flaggedItem = page.locator('.wish-card', { hasText: wishText });
    await expect(flaggedItem).toBeVisible();

    // 6. Admin removes flagged wish
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await flaggedItem.locator('button:has-text("Remove")').click();

    await expect(flaggedItem).not.toBeVisible();
  });
});
