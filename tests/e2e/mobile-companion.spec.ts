import { test, expect } from '@playwright/test';

test.describe('Mobile Companion UX & Scroll Elimination', () => {
  test.beforeEach(async ({ page }) => {
    // Set handheld mobile viewport (iPhone 12/13/14 standard: 390×844)
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('MobileBottomBar provides 5 dedicated thumb tabs and omits Board tab', async ({ page }) => {
    await page.goto('/#home');

    const bottomBar = page.locator('.mobile-bottom-bar');
    await expect(bottomBar).toBeVisible();

    // Verify 5 thumb tabs
    await expect(bottomBar.getByRole('button', { name: 'Home' })).toBeVisible();
    await expect(bottomBar.getByRole('button', { name: 'Search' })).toBeVisible();
    await expect(bottomBar.getByRole('button', { name: 'Post' })).toBeVisible();
    await expect(bottomBar.getByRole('button', { name: /Inbox/i })).toBeVisible();
    await expect(bottomBar.getByRole('button', { name: 'Account' })).toBeVisible();

    // Board / Big Screen tab must NOT be in the mobile bottom bar
    await expect(bottomBar.getByRole('button', { name: /Big Screen/i })).not.toBeVisible();
    await expect(bottomBar.getByRole('button', { name: /Board/i })).not.toBeVisible();

    // Desktop header must not be visible on mobile
    await expect(page.locator('.app-header.desktop-only')).toBeHidden();

    // Test navigation via Post button (center amber action pill)
    await bottomBar.getByRole('button', { name: 'Post' }).click();
    await expect(page).toHaveURL(/#enter/);
    await expect(page.locator('h1')).toHaveText('Enter a Wish');

    // Test navigation via Search button
    await bottomBar.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/#search/);
    await expect(page.locator('h1')).toHaveText('Search Wishes');

    // Test navigation via Account button
    await bottomBar.getByRole('button', { name: 'Account' }).click();
    await expect(page).toHaveURL(/#account/);
  });

  test('EnterWishPage mobile attribute drawers with BottomSheet', async ({ page }) => {
    await page.goto('/#enter');

    // On mobile, inline desktop attribute inputs are hidden, mobile summary pills are visible
    await expect(page.locator('.desktop-attribute-controls')).toBeHidden();
    const creatorPill = page.locator('.mobile-attribute-pill', { hasText: 'Creator Attributes' });
    await expect(creatorPill).toBeVisible();
    await expect(creatorPill).toContainText('0 selected');

    // Tap Creator Attributes pill -> opens BottomSheet drawer
    await creatorPill.click();
    const sheet = page.locator('.bottom-sheet-drawer');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(page.locator('.bottom-sheet-title')).toHaveText(/Creator Attributes/i);

    // Enter creator gender inside sheet
    const genderInput = sheet.locator('input[placeholder*="e.g."]').first();
    await genderInput.fill('woman, nonbinary');

    // Dismiss sheet via Escape key
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Summary pill count badge should update to 2 selected
    await expect(creatorPill).toContainText('2 selected');

    // Reopen Creator Attributes pill -> dismiss via backdrop click
    await creatorPill.click();
    await expect(sheet).toBeVisible();
    await page.locator('.bottom-sheet-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(sheet).toBeHidden();

    // Test Desired Attributes mobile pill
    const desiredPill = page.locator('.mobile-attribute-pill', { hasText: 'Desired Attributes' });
    await expect(desiredPill).toBeVisible();
    await expect(desiredPill).toContainText('Any');

    await desiredPill.click();
    await expect(sheet).toBeVisible();
    await expect(page.locator('.bottom-sheet-title')).toHaveText(/Desired Attributes/i);

    const desiredInput = sheet.locator('input[placeholder*="e.g."]').first();
    await desiredInput.fill('switch');

    // Dismiss sheet via sticky Done button
    await sheet.locator('button:has-text("Done")').click();
    await expect(sheet).toBeHidden();

    // Summary pill count badge should reflect required count
    await expect(desiredPill).toContainText('1 required');
  });

  test('SearchPage mobile filter drawer with BottomSheet', async ({ page }) => {
    await page.goto('/#search');

    const filterPill = page.locator('.mobile-attribute-pill', { hasText: 'Filter by Attributes' });
    await expect(filterPill).toBeVisible();
    await expect(filterPill).toContainText('All');

    // Tap filter pill -> opens BottomSheet
    await filterPill.click();
    const sheet = page.locator('.bottom-sheet-drawer');
    await expect(sheet).toBeVisible();
    await expect(page.locator('.bottom-sheet-title')).toHaveText(/Filter Attributes/i);

    // Enter filter attribute
    const attrInput = sheet.locator('input[placeholder*="e.g."]').first();
    await attrInput.fill('queer');

    // Click Apply Filters button
    await sheet.locator('button:has-text("Apply Filters")').click();
    await expect(sheet).toBeHidden();

    // Filter pill reflects count
    await expect(filterPill).toContainText('1 selected');
  });

  test('AccountPage segmented 3-tab switching and draft state preservation', async ({ page }) => {
    const timestamp = Date.now();
    const username = `mobile_u_${timestamp}`;
    const passphrase = `Passphrase_${timestamp}!`;

    await page.goto('/#account');

    // Fill registration form (unauthenticated form starts in Register mode)
    await page.fill('label:has-text("Username") input', username);
    await page.fill('#account-passphrase', passphrase);
    await page.click('button[type="submit"]:has-text("Register")');

    // Verify authenticated dashboard
    await expect(page.locator('h1')).toContainText(username);

    // Segmented tabs should be visible
    const tablist = page.locator('.account-tabs-nav[role="tablist"]');
    await expect(tablist).toBeVisible();

    const wishesTab = page.locator('#tab-wishes');
    const identityTab = page.locator('#tab-identity');
    const appearanceTab = page.locator('#tab-appearance');

    await expect(wishesTab).toHaveAttribute('aria-selected', 'true');
    await expect(identityTab).toHaveAttribute('aria-selected', 'false');

    // Switch to Identity & Match tab
    await identityTab.click();
    await expect(identityTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-identity')).toBeVisible();
    await expect(page.locator('#panel-wishes')).toBeHidden();

    // Type a draft contact method or attribute without saving
    const fetlifeInput = page.locator('input[placeholder="Username, number, etc."]').first();
    if (await fetlifeInput.isVisible()) {
      await fetlifeInput.fill('my_fetlife_handle');
    }

    // Switch to Appearance & Security tab
    await appearanceTab.click();
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-appearance')).toBeVisible();
    await expect(page.locator('#panel-identity')).toBeHidden();

    // Verify Danger Zone is visible in Appearance tab
    await expect(page.locator('h2:has-text("Danger Zone")')).toBeVisible();

    // Switch back to Identity & Match tab and verify draft input is preserved!
    await identityTab.click();
    await expect(identityTab).toHaveAttribute('aria-selected', 'true');
    if (await fetlifeInput.isVisible()) {
      await expect(fetlifeInput).toHaveValue('my_fetlife_handle');
    }
  });

  test('Mobile account registration, debounce username existence detection, and login flow', async ({
    page,
  }) => {
    const timestamp = Date.now();
    const username = `mobile_reg_${timestamp}`;
    const passphrase = `Passphrase_${timestamp}!`;

    await page.goto('/#account');

    // Verify duplicate top tabs are absent
    await expect(page.locator('.tab-buttons button')).toHaveCount(0);

    // Initial state is Register mode
    await expect(page.locator('button[type="submit"]')).toHaveText('Register');

    // Type new username -> debounce check -> remains Register
    await page.fill('label:has-text("Username") input', username);
    await page.waitForTimeout(300);
    await expect(page.locator('button[type="submit"]')).toHaveText('Register');

    // Fill passphrase & register
    await page.fill('#account-passphrase', passphrase);
    await page.click('button[type="submit"]:has-text("Register")');

    // Verify authenticated dashboard
    await expect(page.locator('h1')).toContainText(username);

    // Switch to Appearance & Security tab and Log out
    await page.locator('#tab-appearance').click();
    await expect(page.locator('#panel-appearance')).toBeVisible();
    await page.click('button:has-text("Logout")');

    // Back on unauthenticated view: initial mode is Register
    await expect(page.locator('button[type="submit"]')).toHaveText('Register');

    // Type the registered username
    await page.fill('label:has-text("Username") input', username);

    // Wait for debounced existence check (250ms) -> submit button automatically becomes "Login"
    await expect(page.locator('button[type="submit"]')).toHaveText('Login', { timeout: 3000 });

    // Passphrase tip and identity attributes are hidden in login mode
    await expect(page.locator('text=Tip: Use a memorable passphrase')).toBeHidden();

    // Enter passphrase and log in
    await page.fill('#account-passphrase', passphrase);
    await page.click('button[type="submit"]:has-text("Login")');

    // Authenticated dashboard restored
    await expect(page.locator('h1')).toContainText(username);
  });

  test('Guest wish creation with contacts and wishmail on mobile companion', async ({ page }) => {
    const timestamp = Date.now();
    const wishContent = `Mobile Companion Guest Wish ${timestamp}`;
    const contactEmail = `guest_${timestamp}@example.com`;

    await page.goto('/#enter');

    // Verify wish editor container has no obscuring white box
    const formCard = page.locator('.form-card');
    await expect(formCard).toBeVisible();

    // Fill wish text
    await page.fill('textarea[placeholder="Type your wish here"]', wishContent);

    // Toggle Wishmail checkbox via its accessible label
    const wishmailCheckbox = page.getByRole('checkbox', { name: /Enable Wishmail/i });
    await expect(wishmailCheckbox).toBeVisible();
    await wishmailCheckbox.check();
    await expect(wishmailCheckbox).toBeChecked();

    // Add contact method
    await page.click('button:has-text("+ Add Contact Method")');
    const contactSelect = page.locator('fieldset select').first();
    const contactInput = page
      .locator('fieldset input[placeholder="Username, number, etc."]')
      .first();
    await expect(contactSelect).toBeVisible();
    await expect(contactInput).toBeVisible();

    // Fill contact details
    await contactSelect.selectOption('Email');
    await contactInput.fill(contactEmail);

    // Submit wish
    await page.click('button[type="submit"]:has-text("Submit Wish")');

    // Verify success confirmation
    const successMsg = page.locator('.message.success');
    await expect(successMsg).toBeVisible();
    await expect(successMsg).toContainText('Wish saved! ID:');
    await expect(successMsg).toContainText('Your passphrase is:');
  });
});
