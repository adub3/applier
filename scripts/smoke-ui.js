import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from '../src/config.js';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:4317', viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 });
const failures = [];
page.on('pageerror', e => failures.push(e.message));
page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:4317', { waitUntil: 'domcontentloaded' });
  await page.locator('#jobs-body tr[data-job]').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#match-button').disabled, null, { timeout: 180000 });
  assert.ok(Number((await page.locator('#stat-total').innerText()).replaceAll(',', '')) > 100);
  await fs.mkdir(DATA, { recursive: true });
  await page.screenshot({ path: path.join(DATA, 'ui-desktop.png'), fullPage: true });

  await page.locator('#platform + .select-text').click();
  await page.getByRole('option', { name: 'Workday', exact: true }).click();
  assert.ok((await page.locator('#jobs-body .platform').allTextContents()).every(p => p === 'Workday'));
  await page.fill('#location', 'this-place-does-not-exist');
  assert.equal(await page.locator('#empty-state').isVisible(), true);
  await page.click('#reset-filters');

  const firstSave = page.locator('[data-save]').first();
  const wasSaved = await firstSave.getAttribute('aria-pressed') === 'true';
  const id = await firstSave.getAttribute('data-save');
  if (!wasSaved) { await firstSave.click(); await page.locator(`[data-save="${id}"][aria-pressed="true"]`).waitFor(); }
  await page.click('[data-view="shortlist"]');
  assert.ok(await page.locator(`[data-job="${id}"]`).count());
  if (!wasSaved) { await page.locator(`[data-save="${id}"]`).click(); await page.locator(`[data-job="${id}"]`).waitFor({ state: 'detached' }); }
  await page.click('[data-view="discover"]');
  await page.locator('[data-job]').first().click();
  await page.locator('#drawer-content h2').waitFor();
  assert.equal(await page.locator('#job-drawer').isVisible(), true);
  assert.ok((await page.locator('#drawer-content a').first().getAttribute('href')).startsWith('https://'));
  await page.screenshot({ path: path.join(DATA, 'ui-detail.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#job-drawer').isVisible(), false);

  await page.click('[data-view="profile"]');
  assert.ok((await page.locator('#profile-text').inputValue()).length > 40);
  await page.click('[data-view="sources"]');
  assert.ok((await page.locator('#model-info').innerText()).includes('nomic-embed-text'));
  await page.click('[data-view="discover"]');

  // Read-only security checks: private API is not available without the page session token.
  const sessionToken = await page.locator('meta[name="app-token"]').getAttribute('content');
  assert.equal((await page.request.get('/api/profile')).status(), 401);
  assert.equal((await page.request.get('/api/profile', { headers: { 'x-app-token': sessionToken, Origin: 'https://untrusted.example' } })).status(), 403);
  assert.equal((await page.request.get('/.local/catalog.sqlite')).status(), 404);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(DATA, 'ui-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Page must not overflow horizontally on mobile');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, checks: ['catalog', 'platform filter', 'empty state', 'reset', 'shortlist add/remove', 'job drawer', 'resume view', 'models view', 'session token', 'cross-origin rejection', 'private-file isolation', 'mobile layout', 'no browser errors'], screenshots: ['ui-desktop.png', 'ui-detail.png', 'ui-mobile.png'] }));
} finally { await browser.close(); }
