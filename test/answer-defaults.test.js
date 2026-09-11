import test from 'node:test';
import assert from 'node:assert/strict';
import { priorEmployerDefault, validateEmploymentHistory } from '../src/answer-defaults.js';
import { openStore } from '../src/db.js';
import { GreenhouseBrowser } from '../src/greenhouse-browser.js';
test('explicit employer-history default never answers eligibility or other unknown questions', () => {
  const history = { reviewed: true, complete: true, entries: [{ employer: 'Example', aliases: ['Example Inc'], title: 'Intern' }] };
  const data = { history, company: 'DraftKings', prompt: 'Have you previously worked for DraftKings? If Yes, please answer the questions below.' };
  assert.equal(priorEmployerDefault(data), 'No');
  assert.equal(priorEmployerDefault({ ...data, history: { ...history, reviewed: false } }), null);
  assert.equal(priorEmployerDefault({ ...data, history: { ...history, complete: false } }), null);
  assert.equal(priorEmployerDefault({ ...data, history: null }), null);
  assert.equal(priorEmployerDefault({ ...data, company: 'Example Inc', prompt: 'Have you ever worked for Example Inc?' }), 'Yes');
  for (const prompt of ['Are you authorized to work in the US?', 'Do you require sponsorship?', 'Are you at least 18?', 'Do you have a disability?', 'Have you previously worked for DraftKings or its subsidiaries?', 'Have you previously worked for Another Employer?', 'Do you have a degree?']) assert.equal(priorEmployerDefault({ ...data, prompt }), null);
});
test('history validation and edits override stale employer answers without rewriting audit records', async () => {
  assert.throws(() => validateEmploymentHistory({ entries: [], complete: true, reviewed: false }));
  assert.throws(() => validateEmploymentHistory({ entries: [{ employer: 'Example', aliases: [], start: '2026-09', end: '2025-01' }] }));
  const store = openStore(':memory:');
  try {
    const worker = new GreenhouseBrowser(store); worker.session = { job: { id: 'job', company: 'Example' } };
    const prompt = 'Have you ever worked for Example?';
    store.saveApplicationQuestion({ jobId: 'job', prompt, answer: 'No', state: 'answered' });
    store.saveReusableAnswer('old', prompt, 'No');
    store.set('employmentHistory', validateEmploymentHistory({ reviewed: true, complete: true, entries: [{ employer: 'Example', aliases: [], title: 'Intern' }] }));
    assert.equal(worker.answers().has(prompt.toLowerCase()), false);
    assert.equal(await worker.defaultAnswer(prompt), 'Yes');
    assert.equal(store.applicationQuestions('job')[0].answer, 'No');
    store.set('employmentHistory', validateEmploymentHistory({ reviewed: true, complete: false, entries: [] }));
    assert.equal(await worker.defaultAnswer(prompt), null);
  } finally { store.close(); }
});
