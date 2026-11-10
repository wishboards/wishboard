import { test, expect } from '@playwright/test';

test.describe('Admin Panel Navigation & Sections E2E Tests', () => {
  test('should login as admin and interact with all admin tabs and sidebar', async ({ page }) => {
    // 1. Visit Admin page
    await page.goto('/#admin');
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

  test('executes live admin user account actions (promote/demote, passphrase reset, and account deletion) without mocks', async ({
    page,
    request,
  }) => {
    const targetUsername = `e2e_admin_target_${Date.now()}`;

    // 1. Seed a real user account via the live backend API
    const registerRes = await request.post('/api/users/register', {
      data: {
        username: targetUsername,
        passphrase: 'initial-e2e-passphrase',
      },
    });
    expect(registerRes.ok()).toBe(true);
    const registeredUser = await registerRes.json();
    expect(registeredUser.id).toBeTruthy();

    // 2. Log in as admin on the Admin Panel
    await page.goto('/#admin');
    await page.fill('label:has-text("Admin username") input', 'admin');
    await page.fill('#admin-passphrase', 'e2e-admin-password');
    await page.click('button[type="submit"]:has-text("Login as Admin")');
    await expect(page.locator('.message.success')).toContainText('Admin login successful.');

    // 3. Navigate to User Accounts tab and locate the seeded user's card
    await page.click('button[title="User Accounts"]');
    const userCard = page.locator('.wish-card', { hasText: targetUsername });
    await expect(userCard).toBeVisible({ timeout: 10000 });
    await expect(userCard).toContainText('Role: user');

    // 4. Promote user to admin and verify live round-trip
    await userCard.locator('button:has-text("Promote")').click();
    await expect(page.locator('.message.success')).toContainText(
      `Updated user role for ${registeredUser.id}`
    );
    await expect(userCard).toContainText('Role: admin');

    // 5. Demote user back to regular user and verify live round-trip
    await userCard.locator('button:has-text("Demote")').click();
    await expect(page.locator('.message.success')).toContainText(
      `Updated user role for ${registeredUser.id}`
    );
    await expect(userCard).toContainText('Role: user');

    // 6. Reset user passphrase (auto-accept browser confirm dialog) and verify non-undefined 3-word passphrase
    page.once('dialog', (dialog) => dialog.accept());
    await userCard.locator('button:has-text("Reset Password")').click();
    const resetBanner = page.locator('.message.success');
    await expect(resetBanner).toContainText(
      `Passphrase for ${targetUsername} successfully reset! The new passphrase is:`
    );
    const bannerText = (await resetBanner.textContent()) ?? '';
    expect(bannerText).not.toContain('undefined');
    expect(bannerText).toMatch(/The new passphrase is:\s+[a-z]+-[a-z]+-[a-z]+/i);

    // 7. Trigger Delete preview modal, confirm deletion, and verify card is removed
    await userCard.locator('button:has-text("Delete")').click();
    await expect(page.locator('h2:has-text("Delete Account Confirmation")')).toBeVisible();
    await page.click('button:has-text("Yes, Delete Account")');

    await expect(page.locator('.message.success')).toContainText(
      `Deleted user ${registeredUser.id}`
    );
    await expect(userCard).toHaveCount(0);
  });
});
