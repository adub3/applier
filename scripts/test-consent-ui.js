import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4317', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-view="profile"]').click();
  const setting = page.locator('#application-terms-enabled');
  await setting.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#application-terms-status')?.textContent.includes('Standing approval'));
  const status = await page.locator('#application-terms-status').innerText();
  assert.equal(await setting.isChecked(), status.includes('is on'));
  assert.match(await page.locator('#application-terms-description').innerText(), /arbitration/);
  assert.deepEqual(errors, []);
  console.log('Profile consent control loads, reflects the saved preference, and explains its scope.');
} finally { await browser.close(); }
