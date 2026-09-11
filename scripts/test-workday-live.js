// Live dashboard test. Submission requires the explicit --submit flag and user authorization.
import { load } from 'cheerio';
import { openStore } from '../src/db.js';
import fs from 'node:fs/promises';
const store = openStore();
try {
  const origin = 'http://127.0.0.1:4317';
  const html = await (await fetch(origin)).text();
  const token = load(html)('meta[name="app-token"]').attr('content');
  const headers = { 'Content-Type': 'application/json', 'x-app-token': token };
  const privateTest = store.get('liveWorkflowTest');
  const job = store.job(process.argv.slice(2).find(arg => !arg.startsWith('--')) || privateTest?.jobId);
  if (!job) throw new Error('Choose a job ID or configure liveWorkflowTest in the private local store.');
  const profile = store.get('profile');
  const name = String(profile.name || '').trim().split(/\s+/);
  const resume = process.argv.includes('--approved-resume') ? { name: privateTest.resume.name, base64: (await fs.readFile(privateTest.resume.path)).toString('base64') } : undefined;
  let revision;
  if (process.argv.includes('--submit')) {
    const state = await (await fetch(origin + '/api/application-browser', { headers })).json();
    if (state.state !== 'review' || state.jobId !== job.id || state.email !== profile.email) throw new Error('Current application must be reviewed with the approved email.');
    const review = await (await fetch(origin + '/api/application-browser', { method: 'POST', headers, body: JSON.stringify({ action: 'inspect' }) })).json();
    if (!review.text?.includes(profile.email)) throw new Error('Approved email is not visible on the review page.');
    revision = state.revision;
  }
  const response = await fetch(origin + '/api/application-browser', { method: 'POST', headers, body: JSON.stringify({ action: process.argv.includes('--submit') ? 'submit' : process.argv.includes('--close') ? 'close' : process.argv.includes('--resume') ? 'resume' : 'start', revision, jobId: job.id, mode: 'full', autoSubmit: false, email: profile.email, firstName: name[0], lastName: name.slice(1).join(' '), resume }) });
  const result = await response.json();
  console.log(JSON.stringify({ company: job.company, title: job.title, state: result.state, message: result.message, missing: result.missing, actions: result.actions, error: result.error }));
  if (!response.ok) process.exitCode = 1;
} finally { store.close(); }
