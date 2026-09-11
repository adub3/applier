import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const b = await chromium.launch({ headless: true });
try {
 const p = await b.newPage();
 await p.goto('https://job-boards.greenhouse.io/aegworldwide/jobs/8782286002', { waitUntil: 'domcontentloaded' });
 await p.locator('#first_name').waitFor();
 const fields = await p.locator('input,textarea,select').evaluateAll(els => els.map(e => ({ id:e.id, name:e.name, role:e.getAttribute('role'), type:e.type, html:e.parentElement.outerHTML.slice(0,6000) })));
 await fs.writeFile('.local/aeg-fields.json', JSON.stringify(fields,null,2));
 console.log(fields.map(f=>({id:f.id,name:f.name,role:f.role,type:f.type})));
 const options = [];
 for (const id of ['candidate-location','question_38183227002']) {
   const el=p.locator(`[id="${id}"]`);await el.click();
   if(id==='school--0') {await el.fill('North Carolina');await p.waitForTimeout(1000);}
   if(id==='candidate-location') {await el.fill('Chapel Hill');await p.waitForTimeout(1500);}
   await p.waitForTimeout(250);
   options.push({id,options:await p.getByRole('option').allTextContents()});
   await el.press('Escape');
 }
 console.log(JSON.stringify(options));
} finally { await b.close(); }
