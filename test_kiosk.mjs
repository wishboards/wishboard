import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  await page.goto('http://localhost:5173/#enter-wish');
  await page.evaluate(() => localStorage.setItem('kiosk', 'true')); // Assuming kiosk uses localStorage, wait no it uses query/hash params or App state

  await page.goto('http://localhost:5173/?kiosk=true#enter-wish');
  await page.waitForLoadState('networkidle');

  await page.waitForSelector('input[type="file"]', { state: 'attached' });
  const fileInput = await page.$('input[type="file"]');

  console.log("Setting input file...");
  // Use dummy.png
  await fileInput.setInputFiles('dummy.png');

  await page.waitForTimeout(5000);

  const processingText = await page.textContent('.message.error').catch(() => null);
  if (processingText) {
    console.log('Error displayed on page:', processingText);
  } else {
    console.log('No .message.error found');
  }

  const html = await page.content();
  if (html.includes('✓ Handwritten wish attached')) {
    console.log("Success! Image processed.");
  } else {
    console.log("Failed. Image NOT processed.");
  }

  await browser.close();
})();
