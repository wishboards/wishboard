const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  await page.goto('http://localhost:5173/');
  // Navigate to wish entry
  await page.click('text="Submit Wish"'); // Wait for this... Actually it's probably "Enter a Wish"

  await page.waitForTimeout(2000);

  await browser.close();
})();
