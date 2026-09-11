// Uses the current private profile and selected resume; no personal data in source.
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import fs from 'node:fs/promises';
import { openStore } from '../src/db.js';
const store = openStore();
try {
  const job = store.job(process.argv[2]);
  assert.equal(job?.platform, 'greenhouse', 'Provide a Greenhouse job ID.');
  const origin = 'http://127.0.0.1:4317';
  const token = load(await (await fetch(origin)).text())('meta[name="app-token"]').attr('content');
  const headers = { 'Content-Type': 'application/json', 'x-app-token': token };
  const profile = store.get('profile');
  const names = profile.name.trim().split(/\s+/);
  const selected = store.get('liveWorkflowTest').resume;
  const action = process.argv.includes('--resume') ? 'resume' : process.argv.includes('--submit') ? 'submit' : process.argv.includes('--close') ? 'close' : 'start';
  let revision;
  if (action !== 'start') {
    const state = await (await fetch(origin + '/api/application-browser', { headers })).json();
    assert.equal(state.jobId, job.id, 'The active job differs from this test.');
    if (action === 'submit') { assert.equal(state.state, 'review'); assert.equal(state.email, profile.email); revision = state.revision; }
  }
  const body = { action, jobId: job.id, revision, mode: 'full', autoSubmit: false, email: profile.email, firstName: names[0], lastName: names.slice(1).join(' ') };
  if (action === 'start') body.resume = { name: selected.name, base64: (await fs.readFile(selected.path)).toString('base64') };
  const response = await fetch(origin + '/api/application-browser', { method: 'POST', headers, body: JSON.stringify(body) });
  const result = await response.json();
  console.log(JSON.stringify({ company: job.company, title: job.title, state: result.state, message: result.message, missing: result.missing, issues: result.automationIssues, actions: result.actions, error: result.error }));
  if (!response.ok) process.exitCode = 1;
} finally { store.close(); }
