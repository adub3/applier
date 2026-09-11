import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openStore } from '../src/db.js';
import { GreenhouseBrowser, greenhouseUrl, questionKey } from '../src/greenhouse-browser.js';

test('Greenhouse shared KB fills education and eligibility and declines new-job demographics without inbox questions', async () => {
  const store = openStore(':memory:'); const browser = await chromium.launch({ headless: true });
  const form = `<!doctype html><label>Email<input id="email" required></label>
    <div class="select-shell"><label for="school--0">School*</label><input id="school--0" role="combobox" required><span class="select__single-value"></span></div>
    <div class="select-shell"><label for="degree--0">Degree*</label><input id="degree--0" role="combobox" required><span class="select__single-value"></span></div>
    <label>Start date year*<input id="start-year--0" type="number" required></label>
    <label>End date year*<input id="end-year--0" type="number" required></label>
    <label>Are you legally authorized to work in the United States?<select id="authorization" required><option value="">Select</option><option>Yes</option><option>No</option></select></label>
    <label>Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B visa status)?<select id="sponsorship" required><option value="">Select</option><option>Yes</option><option>No</option></select></label>
    <label>Gender*<select id="gender" required><option value="">Select</option><option>Male</option><option>Female</option><option value="decline">I prefer not to disclose</option></select></label>
    <label>Veteran status*<select id="veteran" required><option value="">Select</option><option>No, I am not a veteran</option><option value="decline">I choose not to self-identify</option></select></label>
    <div class="select-shell"><label for="disability">Disability*</label><input id="disability" role="combobox" required><span class="select__single-value"></span></div>
    <button id="submit">Submit application</button><script>
      window.submissions = 0; document.querySelector('#submit').onclick = () => window.submissions++;
      for (const [id, choices] of Object.entries({ 'school--0': ['Example University - Other Campus', 'Example University - Main Campus'], 'degree--0': ["Associate's Degree", "Bachelor's Degree", "Master's Degree"], disability: ['Yes, I have a disability', 'No, I do not have a disability', "I don't wish to answer"] })) {
        const input = document.getElementById(id);
        input.onclick = () => {
          document.querySelector('[role="listbox"]')?.remove();
          const list = document.createElement('div'); list.setAttribute('role', 'listbox');
          for (const choice of choices) {
            const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = choice;
            option.onclick = () => { input.parentElement.querySelector('.select__single-value').textContent = choice; input.value = ''; list.remove(); };
            list.append(option);
          }
          document.body.append(list);
        };
      }
    </script>`;
  const worker = new GreenhouseBrowser(store, async () => {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: form }));
    return context;
  });
  try {
    store.set('profile', { approved: true, hash: 'reviewed-profile' });
    store.set('applicationFacts', { reviewed: true, profileHash: 'reviewed-profile', citizenship: 'US', school: 'Example University at Main Campus', degree: 'B.S.', educationStartMonth: '2023-08', graduationMonth: '2027-05' });
    store.set('demographicPreference', { choice: 'decline' });
    assert.deepEqual(store.applicationQuestions(), []);
    assert.deepEqual(store.reusableAnswers(), []);
    const result = await worker.start({ id: 'new-greenhouse-kb', platform: 'greenhouse', scope: 'US', url: 'https://boards.greenhouse.io/fixture/jobs/123', company: 'Fixture Company', title: 'Data Analyst' }, { mode: 'full', email: 'alternate@example.test' });
    assert.equal(result.state, 'review', JSON.stringify({ message: result.message, missing: result.missing }));
    assert.deepEqual(result.missing, []);
    assert.deepEqual(store.applicationQuestions(), []);
    const page = worker.session.page;
    for (const [id, expected] of [['email', 'alternate@example.test'], ['start-year--0', '2023'], ['end-year--0', '2027'], ['authorization', 'Yes'], ['sponsorship', 'No'], ['gender', 'decline'], ['veteran', 'decline']]) assert.equal(await page.locator(`[id="${id}"]`).inputValue(), expected, id);
    assert.equal(await page.locator('#school--0').inputValue(), '');
    assert.equal(await page.locator('#school--0').locator('..').locator('.select__single-value').innerText(), 'Example University - Main Campus');
    assert.equal(await page.locator('#degree--0').inputValue(), '');
    assert.equal(await page.locator('#degree--0').locator('..').locator('.select__single-value').innerText(), "Bachelor's Degree");
    assert.equal(await page.locator('#disability').locator('..').locator('.select__single-value').innerText(), "I don't wish to answer");
    assert.equal(await page.evaluate(() => window.submissions), 0);
    await worker.close();
  } finally { await browser.close(); store.close(); }
});

test('full auto-submit handles final email verification without a second application submission', async () => {
  const store = openStore(':memory:'); const browser = await chromium.launch({ headless: true });
  let submissions = 0;
  const worker = new GreenhouseBrowser(store, async () => {
    const c = await browser.newContext();
    await c.route('**/*', route => {
      if (route.request().method() === 'POST') { submissions++; return route.fulfill({ body: 'ok' }); }
      return route.fulfill({ contentType: 'text/html', body: `<label>Email<input id="email" required></label><button id="submit">Submit application</button><script>
        document.querySelector('#submit').onclick=async()=>{await fetch('/submit',{method:'POST'});document.body.innerHTML='<h1>Thank you for applying. Verify your email</h1><label>Verification code<input autocomplete="one-time-code"></label><button id="verify">Verify code</button>';document.querySelector('#verify').onclick=()=>{if(document.querySelector('input').value==='654321')document.body.innerHTML='<h1>Application received</h1>';else document.body.insertAdjacentHTML('beforeend','<p>Incorrect code</p>');}};
      </script>` });
    }); return c;
  });
  try {
    store.set('profile', { approved: true });
    let result = await worker.start({ id: 'email', platform: 'greenhouse', url: 'https://boards.greenhouse.io/test/jobs/123', company: 'Fixture Company', title: 'Data Analyst' }, { mode: 'full', autoSubmit: true, email: 'alternate@example.test' });
    assert.equal(result.state, 'email_verification'); assert.equal(result.codeEntry, true); assert.equal(submissions, 1);
    assert.equal(store.applicationDraft('email').state, 'submission_unknown');
    assert.throws(() => worker.pause()); await assert.rejects(worker.submit(result.revision));
    result = await worker.verifyEmail('111111'); assert.equal(result.state, 'email_verification');
    assert.equal(await worker.session.page.locator('input').inputValue(), '');
    result = await worker.checkGmail({ findCode: async criteria => { assert.equal(criteria.email, 'alternate@example.test'); assert.ok(criteria.since > 0); return '654321'; } });
    assert.equal(result.state, 'submitted'); assert.equal(submissions, 1);
    assert.equal(store.applicationQuestions().length, 0);
    assert.ok(!JSON.stringify(store.get('greenhouseSession')).includes('654321'));
    assert.equal(store.applicationDraft('email').state, 'submitted');
    await assert.rejects(worker.resume()); await worker.close();
  } finally { await browser.close(); store.close(); }
});

test('Greenhouse URLs require HTTPS and exact supported hosts; questions retain meaningful punctuation', () => {
  for (const u of ['http://boards.greenhouse.io/a', 'https://boards.greenhouse.io.evil.test/a', 'https://u:p@boards.greenhouse.io/a', 'https://boards.greenhouse.io:123/a']) assert.throws(() => greenhouseUrl(u));
  assert.notEqual(questionKey('Have 3+ years?'), questionKey('Have 3 years?'));
});

test('browser fills, uploads, pauses, reuses answers, rejects stale review, submits once and records receipt', async () => {
  const store = openStore(':memory:');
  const browser = await chromium.launch({ headless: true });
  let submissions = 0;
  const form = `<!doctype html><form><label>First name<input name="first_name" required></label><label>Email<input name="email" type="email" required></label><label>Resume<input type="file" name="resume" required></label><label>Work authorization?<select required><option value="">Choose</option><option>Yes</option><option>No</option></select></label><label>Why this role?<textarea required></textarea></label><button>Submit application</button></form><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();await fetch('/receipt',{method:'POST'});document.body.innerHTML='<h1>Application received</h1>'}</script>`;
  const worker = new GreenhouseBrowser(store, async () => {
    const c = await browser.newContext();
    await c.route('**/*', route => { if (route.request().method() === 'POST') { submissions++; return route.fulfill({ body: 'ok' }); } return route.fulfill({ contentType: 'text/html', body: form }); });
    return c;
  });
  try {
    store.set('profile', { approved: true, email: 'real@example.test' });
    const job = { id: 'test', platform: 'greenhouse', url: 'https://boards.greenhouse.io/test/jobs/123', company: 'Fixture', title: 'Test role' };
    store.saveReusableAnswer('legacy', 'Work authorization?', 'Yes');
    let result = await worker.start(job, { mode: 'full', email: 'alternate@example.test', firstName: 'Test', resume: { name: 'test-resume.txt', path: { name: 'test-resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Fixture resume') } } });
    assert.equal(result.state, 'paused');
    assert.equal(await worker.session.page.locator('[name=email]').inputValue(), 'alternate@example.test');
    assert.equal(await worker.session.page.locator('select').inputValue(), 'Yes');
    assert.equal(submissions, 0);
    assert.deepEqual(store.applicationQuestions('test').map(q => q.prompt), ['Why this role?']);
    const q = store.applicationQuestions('test')[0];
    store.saveApplicationQuestion({ id: q.id, jobId: 'test', prompt: q.prompt, answer: 'My reviewed response.', state: 'answered' });
    result = await worker.resume(); assert.equal(result.state, 'review');
    await worker.session.page.locator('[name=email]').fill('changed@example.test');
    result = await worker.submit(result.revision); assert.equal(result.state, 'paused'); assert.equal(submissions, 0);
    result = await worker.resume();
    result = await worker.submit(result.revision);
    assert.equal(result.state, 'submitted'); assert.equal(submissions, 1);
    assert.equal(store.applicationDraft('test').state, 'submitted');
    await assert.rejects(worker.submit(result.revision)); assert.equal(submissions, 1);
    await worker.close();
    await assert.rejects(worker.start(job, { mode: 'full', email: 'alternate@example.test' }), /already submitted/);
  } finally { await browser.close(); store.close(); }
});

test('full advances recognized steps; none never fills or exposes submission', async () => {
  const store = openStore(':memory:'); const browser = await chromium.launch({ headless: true });
  const worker = new GreenhouseBrowser(store, async () => {
    const c = await browser.newContext();
    await c.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<label>Email<input name="email" required></label><button onclick="this.remove();document.querySelector('input').insertAdjacentHTML('afterend','<button>Submit application</button>')">Next</button>` }));
    return c;
  });
  const job = { id: 'steps', platform: 'greenhouse', url: 'https://boards.greenhouse.io/test/jobs/123', title: 'Test', company: 'Fixture' };
  try {
    store.set('profile', { approved: true });
    let result = await worker.start(job, { mode: 'none', email: 'test@example.test' });
    assert.equal(result.state, 'paused'); assert.equal(await worker.session.page.locator('input').inputValue(), '');
    await assert.rejects(worker.submit(result.revision)); await worker.close();
    result = await worker.start(job, { mode: 'full', email: 'test@example.test' });
    assert.equal(result.state, 'review'); assert.equal(await worker.session.page.getByRole('button', { name: 'Next', exact: true }).count(), 0);
    await worker.close();
  } finally { await browser.close(); store.close(); }
});

test('missing employer confirmation is uncertain and cannot be retried automatically', async () => {
  const store = openStore(':memory:'); const browser = await chromium.launch({ headless: true }); let clicks = 0;
  const worker = new GreenhouseBrowser(store, async () => {
    const c = await browser.newContext();
    await c.route('**/*', route => {
      if (route.request().method() === 'POST') { clicks++; return route.fulfill({ body: 'ok' }); }
      return route.fulfill({ contentType: 'text/html', body: `<label>Email<input name="email" required></label><button onclick="fetch('/submit',{method:'POST'})">Submit application</button>` });
    }); return c;
  });
  try {
    store.set('profile', { approved: true });
    let result = await worker.start({ id: 'uncertain', platform: 'greenhouse', url: 'https://boards.greenhouse.io/test/jobs/123' }, { mode: 'full', email: 'test@example.test' });
    result = await worker.submit(result.revision);
    assert.equal(result.state, 'submission_unknown'); assert.equal(clicks, 1);
    assert.equal(store.applicationDraft('uncertain').state, 'submission_unknown');
    await assert.rejects(worker.resume()); await assert.rejects(worker.submit(result.revision)); assert.equal(clicks, 1);
    await worker.close();
  } finally { await browser.close(); store.close(); }
});

test('pause hands control over, preview is read-only, resume preserves manual edits', async () => {
  const store = openStore(':memory:'); const browser = await chromium.launch({ headless: true });
  const worker = new GreenhouseBrowser(store, async () => {
    const c = await browser.newContext();
    await c.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<label>Email<input id="email" required></label><button>Submit application</button>' }));
    return c;
  });
  try {
    store.set('profile', { approved: true });
    const initial = await worker.start({ id: 'pause-test', platform: 'greenhouse', url: 'https://boards.greenhouse.io/test/jobs/123' }, { mode: 'full', email: 'test@example.test' });
    assert.equal(initial.state, 'review'); assert.equal(worker.pause().state, 'manual');
    await assert.rejects(worker.submit(initial.revision));
    assert.match((await worker.preview()).image, /^data:image\/jpeg;base64,/);
    await worker.session.page.locator('#email').fill('manual@example.test');
    assert.equal((await worker.resume()).state, 'review');
    assert.equal(await worker.session.page.locator('#email').inputValue(), 'manual@example.test');
    await worker.close();
  } finally { await browser.close(); store.close(); }
});
