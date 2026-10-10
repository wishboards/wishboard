import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();

  // Fake video to emulate camera
  const context = await browser.newContext({
    permissions: ['camera'],
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ]
  });

  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle');
  await page.click('text="Enter a Wish"');
  await page.waitForLoadState('networkidle');

  await page.click('text="Capture with Camera"');

  // Wait a bit for processing
  await page.waitForTimeout(5000);

  await browser.close();
})();
