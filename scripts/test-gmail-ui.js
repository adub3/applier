import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-gmail-ui-'));
const origin = 'http://127.0.0.1:4328';
const server = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, JOB_BOT_PORT: '4328', JOB_BOT_DATA: directory }, windowsHide: true, stdio: 'pipe' });
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start')), 15000);
    server.stdout.on('data', chunk => { if (chunk.toString().includes('Job Desk is running')) { clearTimeout(timeout); resolve(); } });
    server.on('error', reject);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/#profile');
  await page.locator('#gmail-panel').filter({ hasText: 'WIP' }).waitFor();
  assert.equal(await page.locator('#gmail-connect').count(), 0);
  assert.equal(await page.locator('#profile-view #reusable-answers').count(), 1);
  assert.equal(await page.locator('#applications-view #application-drafts').count(), 0);
  assert.equal(await page.locator('#gmail-credentials').count(), 0);
  await page.locator('#add-employment').click();
  await page.locator('[data-employment-employer]').fill('Fixture Employer');
  await page.locator('[data-employment-aliases]').fill('Fixture Alias');
  await page.locator('#employment-reviewed').check(); await page.locator('#employment-complete').check();
  await page.locator('[data-employment-title]').fill('Intern');
  assert.equal(await page.locator('#employment-complete').isChecked(), false);
  await page.locator('#employment-reviewed').check(); await page.locator('#employment-complete').check();
  await page.locator('#save-employment').click();
  await page.waitForFunction(() => document.querySelector('#save-employment').disabled === false);
  const token = await page.locator('meta[name=app-token]').getAttribute('content');
  const noToken = await page.request.post(origin + '/api/gmail', { data: { action: 'connect' } });
  assert.equal(noToken.status(), 401);
  const crossOrigin = await page.request.post(origin + '/api/gmail', { headers: { 'x-app-token': token, Origin: 'https://evil.test' }, data: { action: 'connect' } });
  assert.equal(crossOrigin.status(), 403);
  await page.locator('[data-view=history]').click();
  await page.locator('#history-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#history-view #application-drafts').isVisible(), true);
  await page.locator('[data-view=applications]').click();
  await page.locator('#browser-mode').waitFor({ state: 'attached' });
  assert.match(await page.locator('#browser-mode option[value=full]').textContent(), /submit/);
  assert.equal(await page.locator('#application-drafts').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
  console.log('Gmail setup, route protection, Full mode label, profile library, history navigation, and mobile layout passed. No real email or employer requests made.');
} finally {
  await browser?.close();
  server.kill();
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
