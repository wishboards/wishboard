import { test, expect } from '@playwright/test';

test.describe('Admin Panel Navigation & Sections E2E Tests', () => {
  test('should login as admin and interact with all admin tabs and sidebar', async ({ page }) => {
    // 1. Visit Admin page
    await page.goto('/');
    await page.click('button:has-text("Admin")');
    await expect(page.locator('h1')).toHaveText('Admin Panel');

    // 2. Log in
    await page.fill('label:has-text("Admin username") input', 'admin');
    await page.fill('#admin-passphrase', 'e2e-admin-password');
    await page.click('button[type="submit"]:has-text("Login as Admin")');

    await expect(page.locator('.message.success')).toContainText('Admin login successful.');

    // 3. Tab 1: Matching Rules (default active tab)
    await page.click('button[title="Matching Rules"]');
    await expect(page.locator('h2:has-text("Matching Rules")')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();

    // 4. Tab 2: Flagged Wishes
    await page.click('button[title="Flagged Wishes"]');
    await expect(page.locator('h2:has-text("Flagged Wishes")')).toBeVisible();

    // 5. Tab 3: User Accounts
    await page.click('button[title="User Accounts"]');
    await expect(page.locator('h2:has-text("User Accounts")')).toBeVisible();
    await expect(page.locator('.wish-card', { hasText: 'admin' })).toBeVisible({ timeout: 10000 });

    // 6. Tab 4: System Overview
    await page.click('button[title="System Overview"]');
    await expect(page.locator('h2:has-text("System Metrics")')).toBeVisible();

    // 7. Sidebar collapse / expand
    const collapseButton = page.locator('button[aria-label="Toggle Sidebar"]');
    await expect(collapseButton).toContainText('Collapse');
    await collapseButton.click();

    await expect(collapseButton).toContainText('▶');
    await collapseButton.click();
    await expect(collapseButton).toContainText('Collapse');

    // 8. Log out
    await page.click('button:has-text("Log out")');
    await expect(page.locator('button[type="submit"]:has-text("Login as Admin")')).toBeVisible();
  });
});
