import { test, expect } from '@playwright/test';

test.describe('User Account Lifecycle E2E Tests', () => {
  test('should register a new account, manage profile, post wish with account attributes, and logout', async ({
    page,
  }) => {
    const timestamp = Date.now();
    const username = `testuser_${timestamp}`;
    const passphrase = `Passphrase_${timestamp}!`;

    // 1. Visit Account page
    await page.goto('/');
    await page.click('button:has-text("My Account")');
    await expect(page.locator('h1')).toHaveText('My Account');

    // 2. Initial state is Registration mode
    await expect(page.locator('button[type="submit"]')).toHaveText('Register');

    // 3. Fill registration form
    await page.fill('label:has-text("Username") input', username);
    await page.fill('#account-passphrase', passphrase);

    // Set identity attributes on registration
    await page.fill('label:has-text("Identity Genders") input[type="text"]', 'woman, non-binary');
    await page.fill('label:has-text("Identity Orientations") input[type="text"]', 'lesbian');
    await page.fill('label:has-text("Identity Roles") input[type="text"]', 'switch');

    // Submit registration
    await page.click('button[type="submit"]:has-text("Register")');

    // 4. Verify authenticated dashboard
    await expect(page.locator('h1')).toContainText(username);

    // 5. Navigate to Enter Wish page as logged-in user
    await page.click('button:has-text("Enter a Wish")');
    await expect(page.locator('h1')).toHaveText('Enter a Wish');

    // Verify account attributes note is shown for authenticated user
    await expect(
      page.locator('text=Your account identity attributes are applied automatically')
    ).toBeVisible();

    // Submit a wish as authenticated user
    const userWishText = `Authenticated Wish from ${username} - ${timestamp}`;
    await page.fill('textarea[placeholder="Type your wish here"]', userWishText);
    await page.click('button[type="submit"]:has-text("Submit Wish")');

    await expect(page.locator('.message.success')).toContainText('Wish saved!');

    // 6. Return to Account page and verify wish appears in My Wishes
    await page.click('button:has-text("My Account")');
    await expect(page.locator('.wish-card', { hasText: userWishText })).toBeVisible();

    // 7. Logout
    await page.click('button:has-text("Log out")');
    await expect(page.locator('button[type="submit"]')).toHaveText('Register');

    // 8. Re-login (enter registered username, wait for debounced existence check to switch mode to Login)
    await page.fill('label:has-text("Username") input', username);
    await expect(page.locator('button[type="submit"]')).toHaveText('Login');
    await page.fill('#account-passphrase', passphrase);
    await page.click('button[type="submit"]:has-text("Login")');

    await expect(page.locator('h1')).toContainText(username);
  });
});
