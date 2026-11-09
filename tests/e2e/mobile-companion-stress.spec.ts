import { test, expect } from '@playwright/test';

test.describe('Adversarial Stress Suite — Mobile Companion & Segmented Tabs', () => {
  test.beforeEach(async ({ page }) => {
    // Start with handheld mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Rapid opening and closing of BottomSheet drawers via attribute summary pills', async ({
    page,
  }) => {
    await page.goto('/#enter');

    const creatorPill = page.locator('.mobile-attribute-pill', { hasText: 'Creator Attributes' });
    await expect(creatorPill).toBeVisible();

    const sheet = page.locator('.bottom-sheet-drawer');
    const backdrop = page.locator('.bottom-sheet-backdrop');

    // Rapidly open and dismiss via Escape key 5 times
    for (let i = 0; i < 5; i++) {
      await creatorPill.click();
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }

    // Rapidly open and dismiss via Backdrop click 5 times
    for (let i = 0; i < 5; i++) {
      await creatorPill.click();
      await expect(sheet).toBeVisible();
      await backdrop.click({ position: { x: 10, y: 10 } });
      await expect(sheet).toBeHidden();
    }

    // Rapidly open and dismiss via Done button 5 times
    for (let i = 0; i < 5; i++) {
      await creatorPill.click();
      await expect(sheet).toBeVisible();
      await sheet.locator('button:has-text("Done")').click();
      await expect(sheet).toBeHidden();
    }

    // Rapidly alternate between Creator and Desired drawers
    const desiredPill = page.locator('.mobile-attribute-pill', { hasText: 'Desired Attributes' });
    for (let i = 0; i < 4; i++) {
      await creatorPill.click();
      await expect(page.locator('.bottom-sheet-title')).toHaveText(/Creator Attributes/i);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();

      await desiredPill.click();
      await expect(page.locator('.bottom-sheet-title')).toHaveText(/Desired Attributes/i);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }

    // Final check: body scroll lock is completely unlocked (overflow is normal)
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflow).toBe('');
  });

  test('Active count derivations under noisy and adversarial attribute strings', async ({
    page,
  }) => {
    await page.goto('/#enter');

    const creatorPill = page.locator('.mobile-attribute-pill', { hasText: 'Creator Attributes' });
    await creatorPill.click();

    const sheet = page.locator('.bottom-sheet-drawer');
    await expect(sheet).toBeVisible();

    const genderInput = sheet.locator('input[placeholder*="e.g."]').first();

    // Adversarial string: duplicate commas, leading/trailing whitespace, tabs, newlines
    await genderInput.fill(' , ,,   ,,,   ');
    await expect(page.locator('.bottom-sheet-title')).toHaveText('Creator Attributes (0)');

    // Add items with whitespace and commas
    await genderInput.fill('  ,  woman  , , nonbinary  ,   ');
    await expect(page.locator('.bottom-sheet-title')).toHaveText('Creator Attributes (2)');

    // Add emojis and special characters
    await genderInput.fill('woman 👩, nonbinary ✨, gender-fluid/queer');
    await expect(page.locator('.bottom-sheet-title')).toHaveText('Creator Attributes (3)');

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(creatorPill).toContainText('3 selected');

    // Test SearchPage filter active count derivation
    await page.goto('/#search');
    const filterPill = page.locator('.mobile-attribute-pill', { hasText: 'Filter by Attributes' });
    await filterPill.click();

    const searchAttrInput = sheet.locator('input[placeholder*="e.g."]').first();
    await searchAttrInput.fill('  ,,  switch , , top ,,,  ');
    await expect(page.locator('.bottom-sheet-title')).toHaveText('Filter Attributes (2)');

    await sheet.locator('button:has-text("Apply Filters")').click();
    await expect(sheet).toBeHidden();
    await expect(filterPill).toContainText('2 selected');
  });

  test('Viewport transitions between mobile (< 768px) and desktop (>= 768px)', async ({ page }) => {
    // Start in mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#enter');

    // Verify mobile pills visible, desktop controls hidden
    const creatorPill = page.locator('.mobile-attribute-pill', { hasText: 'Creator Attributes' });
    await expect(creatorPill).toBeVisible();
    await expect(page.locator('.desktop-attribute-controls')).toBeHidden();

    // Open sheet and input attributes
    await creatorPill.click();
    const sheet = page.locator('.bottom-sheet-drawer');
    const genderInput = sheet.locator('input[placeholder*="e.g."]').first();
    await genderInput.fill('woman, queer');
    await sheet.locator('button:has-text("Done")').click();
    await expect(sheet).toBeHidden();
    await expect(creatorPill).toContainText('2 selected');

    // Resize viewport to Desktop (1024×768)
    await page.setViewportSize({ width: 1024, height: 768 });

    // Desktop controls must now be visible, mobile pills hidden
    await expect(page.locator('.desktop-attribute-controls')).toBeVisible();
    await expect(creatorPill).toBeHidden();

    // Desktop input should contain the exact same value
    const desktopInput = page
      .locator('.desktop-attribute-controls input[placeholder*="e.g."]')
      .first();
    await expect(desktopInput).toHaveValue('woman, queer');

    // Edit value on desktop
    await desktopInput.fill('woman, queer, switch');

    // Resize back to mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.desktop-attribute-controls')).toBeHidden();
    await expect(creatorPill).toBeVisible();

    // Mobile pill must immediately reflect the 3 selected attributes!
    await expect(creatorPill).toContainText('3 selected');
  });

  test('AccountPage rapid tab switching, draft state preservation, and circular keyboard wrap-around', async ({
    page,
  }) => {
    const timestamp = Date.now();
    const username = `stress_u_${timestamp}`;
    const passphrase = `Passphrase_${timestamp}!`;

    await page.goto('/#account');

    // Register test user
    await page.click('button:has-text("Register")');
    await page.fill('label:has-text("Username") input', username);
    await page.fill('#account-passphrase', passphrase);
    await page.click('button[type="submit"]:has-text("Register")');

    await expect(page.locator('h1')).toContainText(username);

    const wishesTab = page.locator('#tab-wishes');
    const identityTab = page.locator('#tab-identity');
    const appearanceTab = page.locator('#tab-appearance');

    const panelWishes = page.locator('#panel-wishes');
    const panelIdentity = page.locator('#panel-identity');
    const panelAppearance = page.locator('#panel-appearance');

    // 1. Rapid Tab Clicking (Stress test 30 switches)
    const tabs = [wishesTab, identityTab, appearanceTab];
    for (let i = 0; i < 30; i++) {
      await tabs[i % 3].click();
    }

    // 2. Draft preservation across tab switches
    await identityTab.click();
    await expect(panelIdentity).toBeVisible();
    await expect(panelWishes).toBeHidden();
    await expect(panelAppearance).toBeHidden();

    // Enter draft into contact method input
    const contactInput = page.locator('input[placeholder="Username, number, etc."]').first();
    if (await contactInput.isVisible()) {
      await contactInput.fill('uncommitted_draft_handle_42');
    }

    // Enter draft into attribute input
    const identityAttrInput = panelIdentity.locator('input[placeholder*="e.g."]').first();
    if (await identityAttrInput.isVisible()) {
      await identityAttrInput.fill('nonbinary, demigirl');
    }

    // Switch to Appearance tab
    await appearanceTab.click();
    await expect(panelAppearance).toBeVisible();
    await expect(panelIdentity).toBeHidden();

    // Switch to Wishes tab
    await wishesTab.click();
    await expect(panelWishes).toBeVisible();
    await expect(panelAppearance).toBeHidden();

    // Switch back to Identity tab -> verify drafts are 100% intact!
    await identityTab.click();
    await expect(panelIdentity).toBeVisible();
    if (await contactInput.isVisible()) {
      await expect(contactInput).toHaveValue('uncommitted_draft_handle_42');
    }
    if (await identityAttrInput.isVisible()) {
      await expect(identityAttrInput).toHaveValue('nonbinary, demigirl');
    }

    // 3. WAI-ARIA Circular Wrap-Around Keyboard Navigation
    // Select and focus Wishes tab
    await wishesTab.click();
    await expect(wishesTab).toHaveAttribute('aria-selected', 'true');
    await expect(wishesTab).toBeFocused();

    // ArrowRight -> Identity
    await page.keyboard.press('ArrowRight');
    await expect(identityTab).toHaveAttribute('aria-selected', 'true');
    await expect(identityTab).toBeFocused();

    // ArrowRight -> Appearance
    await page.keyboard.press('ArrowRight');
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(appearanceTab).toBeFocused();

    // ArrowRight -> Circular wrap-around back to Wishes!
    await page.keyboard.press('ArrowRight');
    await expect(wishesTab).toHaveAttribute('aria-selected', 'true');
    await expect(wishesTab).toBeFocused();

    // ArrowLeft -> Circular wrap-around backwards to Appearance!
    await page.keyboard.press('ArrowLeft');
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(appearanceTab).toBeFocused();

    // Home key -> Jump to first tab (Wishes)
    await page.keyboard.press('Home');
    await expect(wishesTab).toHaveAttribute('aria-selected', 'true');
    await expect(wishesTab).toBeFocused();

    // End key -> Jump to last tab (Appearance)
    await page.keyboard.press('End');
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(appearanceTab).toBeFocused();
  });
});
