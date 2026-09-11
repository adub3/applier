// Authenticated, pre-submission inspection of the active Workday page.
import { load } from 'cheerio';
const origin = 'http://127.0.0.1:4317';
const token = load(await (await fetch(origin)).text())('meta[name="app-token"]').attr('content');
const response = await fetch(origin + '/api/application-browser', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-token': token }, body: JSON.stringify({ action: 'inspect', fieldId: process.argv[2] }) });
console.log(JSON.stringify(await response.json()));
if (!response.ok) process.exitCode = 1;
