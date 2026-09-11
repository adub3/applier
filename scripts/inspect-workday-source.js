import { chromium } from 'playwright';
import { openStore } from '../src/db.js';
const store = openStore(); const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } }); page.setDefaultTimeout(15000);
  await page.goto(store.job('70b7c10f1411b40d4057d570').url);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Manually', exact: true }).click();
  await page.locator('[id="phoneNumber--phoneNumber"]').waitFor();
  const source = page.locator('[id="source--source"]');
  const container = source.locator('xpath=ancestor::*[@data-automation-id="multiselectInputContainer"]');
  await container.locator('[data-automation-id="promptIcon"]').click();
  await page.locator('[data-automation-id="promptOption"][data-automation-label="Job Boards"]').click();
  await page.waitForTimeout(1000);
  console.log((await page.locator('body').innerText()).slice(-4500));
  console.log(await page.locator('[data-automation-id="promptOption"]').evaluateAll(elements => elements.map(el=>({text:el.textContent,html:el.parentElement.outerHTML.slice(0,700)}))));
} finally { await browser.close(); store.close(); }
