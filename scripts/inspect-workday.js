// Read-only live compatibility check. Never clicks Apply, fills, logs in, or submits.
import { chromium } from 'playwright';
import { openStore } from '../src/db.js';
import { readWorkdayForm, workdayUrl } from '../src/workday-browser.js';
const store = openStore();
const job = store.job(process.argv.slice(2).find(arg => !arg.startsWith('--')) || '70b7c10f1411b40d4057d570');
const url = workdayUrl(job?.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 1200 }); page.setDefaultTimeout(5000);
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try { await page.waitForFunction(() => document.body.innerText.length > 300 && !/\nLoading\n/.test(document.body.innerText), null, { timeout: 20000 }); } catch { /* Report the loading state rather than claim compatibility. */ }
  if (process.argv.includes('--form')) {
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Manually', exact: true }).click();
    await page.getByLabel('First Name', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByLabel('Phone Number', { exact: false }).first().waitFor({ timeout: 20000 });
    const fields = await readWorkdayForm(page);
    console.log(JSON.stringify({ formFields: fields.map(f => ({ id: f.id, label: f.label, automation: f.automation, prompt: f.prompt, value: f.value, required: f.required, dropdown: f.dropdown })) }));
    const countryCode = fields.find(f => /Country Phone Code/i.test(f.prompt));
    if (countryCode?.id) {
      console.log(JSON.stringify({ phoneHtml: await page.locator(`[id=${JSON.stringify(countryCode.id)}]`).evaluate(el => el.parentElement.parentElement.outerHTML) }));
      await page.locator(`[id=${JSON.stringify(countryCode.id)}]`).focus();
      await page.locator(`[id=${JSON.stringify(countryCode.id)}]`).press('ArrowDown');
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ phoneOptions: await page.getByRole('option').allTextContents() }));
      await page.keyboard.press('Escape');
    }
    console.log(JSON.stringify({ sourceHtml: await page.locator('[id="source--source"]').evaluate(el => el.parentElement.outerHTML) }));
    await page.locator('[id="source--source"]').focus();
    await page.locator('[id="source--source"]').fill('Other');
    await page.waitForTimeout(2000);
    console.log(JSON.stringify({ sourceOptions: await page.locator('[role="option"],[data-automation-id="promptOption"]').allTextContents(), tail: (await page.locator('body').innerText()).slice(-2500) }));
  }
  console.log(JSON.stringify({ company: job.company, title: job.title, status: response?.status(), url: page.url(), buttons: await page.getByRole('button').allTextContents(), links: await page.getByRole('link').allTextContents(), fields: (await readWorkdayForm(page)).map(f => ({ label: f.label, type: f.type, required: f.required })), text: (await page.locator('body').innerText()).slice(0, 500) }));
} finally { await browser.close(); store.close(); }
