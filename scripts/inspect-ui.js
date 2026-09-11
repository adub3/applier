import { chromium } from 'playwright';
import path from 'node:path';
import { DATA } from '../src/config.js';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
  await page.goto('http://127.0.0.1:4317');
  await page.locator('[data-job]').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#match-button').disabled, null, { timeout: 180000 });
  await page.screenshot({ path: path.join(DATA, 'desktop-viewport.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, outside: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth); }).map(el => ({ tag: el.tagName, id: el.id, class: String(el.className), width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).slice(0, 30) }))));
  await page.screenshot({ path: path.join(DATA, 'mobile-viewport.png') });
} finally { await browser.close(); }
