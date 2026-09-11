import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openStore } from '../src/db.js';
import { WorkdayBrowser, workdayUrl, readWorkdayForm } from '../src/workday-browser.js';

const job = { id: 'workday-test', platform: 'workday', url: 'https://fixture.wd5.myworkdayjobs.com/en-US/Careers/job/Analyst_R123', company: 'Fixture', title: 'Data Analyst' };
test('Workday host validation rejects credentials, ports, lookalikes and unsupported site types', () => {
  assert.equal(workdayUrl(job.url).hostname, 'fixture.wd5.myworkdayjobs.com');
  for (const url of ['http://fixture.myworkdayjobs.com/job', 'https://fixture.myworkdayjobs.com.evil.test/job', 'https://user:pass@fixture.myworkdayjobs.com/job', 'https://fixture.myworkdayjobs.com:8443/job', 'https://wd5.myworkdaysite.com/job']) assert.throws(() => workdayUrl(url));
});
async function fixture(html) {
  const store = openStore(':memory:'); store.set('profile', { approved: true, phone: '5551234567', city: 'Chapel Hill' });
  const browser = await chromium.launch({ headless: true }); let submissions = 0;
  const worker = new WorkdayBrowser(store, async () => {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (route.request().method() === 'POST') { submissions++; return route.fulfill({ body: 'ok' }); }
      return route.fulfill({ contentType: 'text/html', body: html });
    }); return context;
  });
  return { worker, store, submissions: () => submissions, close: async () => { await browser.close(); store.close(); } };
}
const options = { mode: 'full', autoSubmit: true, email: 'alternate@example.test', firstName: 'Test', lastName: 'Candidate' };
test('full-mode standing consent reads terms and records acceptance without asking again', async () => {
  const f = await fixture(`<h2>Terms and Conditions</h2><p>The details provided are truthful and correct. I agree to the Privacy Notice and affirm legal capacity to consent.</p><label>Yes, I have read and consent to the terms and conditions*<input type="checkbox" required></label>`);
  try {
    f.store.set('applicationConsent', { applicationTerms: true });
    const result = await f.worker.start(job, { ...options, autoSubmit: false });
    assert.deepEqual(result.missing, []);
    assert.equal(await f.worker.session.page.locator('input').isChecked(), true);
    assert.equal(f.store.applicationQuestions(job.id).length, 0);
    const event = f.store.db.prepare("SELECT data FROM events WHERE kind='application_terms_accepted'").get();
    assert.equal(JSON.parse(event.data).standingApproval, true);
    assert.match(JSON.parse(event.data).terms, /truthful and correct/);
  } finally { await f.close(); }
});
test('approved age answer matches an expanded label without accepting unrelated declarations', async () => {
  const f = await fixture(`<label>First Name<input required></label><label for="age">Are you 18 years of age or older?*</label><button id="age" aria-haspopup="listbox">Select One</button><script>document.querySelector('button').onclick=()=>{const option=document.createElement('div');option.setAttribute('role','option');option.textContent='Yes, I am 18 years of age or older';document.body.append(option);option.onclick=()=>{document.querySelector('button').textContent=option.textContent;option.remove()}};</script>`);
  try {
    f.store.saveReusableAnswer('age', 'Are you 18 years of age or older?', 'Yes');
    const result = await f.worker.start(job, { ...options, mode: 'medium' });
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.automationIssues || [], []);
    assert.equal((await readWorkdayForm(f.worker.session.page)).find(field => field.id === 'age').value, 'Yes, I am 18 years of age or older');
  } finally { await f.close(); }
});
for (const autoSelect of [false, true]) test(`education school search commits the matching institution (Enter auto-select: ${autoSelect})`, async () => {
  const f = await fixture(`<label for="education-1--school">School or University*</label><div data-automation-id="multiselectInputContainer"><input id="education-1--school" data-uxi-widget-type="selectinput"><button data-automation-id="promptIcon">Open</button></div><script>
    document.querySelector('input').onkeydown=e=>{if(e.key!=='Enter')return;const menu=document.createElement('div');menu.dataset.automationId='promptLeafNode';menu.innerHTML='<div data-automation-id="promptOption">Example University</div>';document.body.append(menu);menu.firstChild.onclick=()=>{document.querySelector('[data-automation-id=multiselectInputContainer]').insertAdjacentHTML('beforeend','<div data-automation-id="selectedItem"><span data-automation-id="promptOption">Example University</span></div>');menu.remove()};if(${autoSelect})menu.firstChild.click()};
  </script>`);
  try {
    f.store.set('profile', { approved: true, hash: 'education' });
    f.store.set('applicationFacts', { reviewed: true, profileHash: 'education', school: 'Example University' });
    const result = await f.worker.start(job, { ...options, mode: 'medium' });
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.automationIssues || [], []);
    assert.equal((await readWorkdayForm(f.worker.session.page))[0].value, 'Example University');
  } finally { await f.close(); }
});
test('profile facts override stale portal IDs and mobile matches Personal Cell', async () => {
  const f = await fixture(`<label>First Name<input required></label><label for="state">State*</label><button id="state" aria-haspopup="listbox" value="">Select One</button><label for="phone">Phone Device Type*</label><button id="phone" aria-haspopup="listbox">Select One</button><script>
    for (const button of document.querySelectorAll('button')) button.onclick=()=>{const option=document.createElement('div');option.setAttribute('role','option');option.textContent=button.id==='state'?'North Carolina':'Personal Cell';document.body.append(option);option.onclick=()=>{button.textContent=option.textContent;button.value='opaque-portal-id';option.remove()}};
  </script>`);
  try {
    f.store.set('profile', { ...f.store.get('profile'), state: 'North Carolina', phoneType: 'Mobile' });
    f.store.saveApplicationQuestion({ jobId: job.id, prompt: 'State*', answer: 'old-portal-id', state: 'answered' });
    const result = await f.worker.start(job, { ...options, mode: 'medium' });
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.automationIssues || [], []);
    const fields = await readWorkdayForm(f.worker.session.page);
    assert.equal(fields.find(field => field.id === 'state').value, 'North Carolina');
    assert.equal(fields.find(field => field.id === 'phone').value, 'Personal Cell');
  } finally { await f.close(); }
});
test('approved source-survey defaults complete hierarchical options without an inbox question', async () => {
  const f = await fixture(`<label for="source">How Did You Hear About Us?*</label><div data-automation-id="multiselectInputContainer"><input id="source" data-uxi-widget-type="selectinput"><button data-automation-id="promptIcon">Open</button></div><script>
    document.querySelector('button').onclick=()=>{const menu=document.createElement('div');menu.id='menu';menu.dataset.automationId='promptLeafNode';menu.innerHTML='<div data-automation-id="promptOption">Job Boards</div>';document.body.append(menu);menu.firstChild.onclick=()=>{menu.innerHTML='<div data-automation-id="promptOption">Career Site</div>';menu.firstChild.onclick=()=>{document.querySelector('[data-automation-id=multiselectInputContainer]').insertAdjacentHTML('beforeend','<div data-automation-id="selectedItem"><div data-automation-id="promptOption">Career Site</div></div>');menu.remove()}}};
  </script>`);
  try {
    f.store.set('applicationPreferences', { sourceSurveyDefaults: true });
    const result = await f.worker.start(job, { ...options, mode: 'medium' });
    assert.deepEqual(result.missing, []);
    assert.equal(f.store.applicationQuestions(job.id).length, 0);
    assert.equal((await readWorkdayForm(f.worker.session.page))[0].value, 'Career Site');
  } finally { await f.close(); }
});
test('long applications advance beyond 20 steps even when successive pages reuse the same controls', async () => {
  const f = await fixture(`<h2 id="step">Step 1</h2><label>First Name<input required></label><button id="next">Next</button><script>
    let step=1;document.querySelector('#next').onclick=()=>{step++;document.querySelector('#step').textContent='Step '+step;if(step===23){document.querySelector('input').parentElement.remove();document.querySelector('#next').textContent='Submit';document.querySelector('#next').onclick=null;}};
  </script>`);
  try {
    const result = await f.worker.start(job, { ...options, autoSubmit: false });
    assert.equal(result.state, 'review', result.message);
    assert.equal(await f.worker.session.page.locator('#step').innerText(), 'Step 23');
    assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});
test('employer navigation is not an application; Apply opens the form and unnamed controls retain their indexes', async () => {
  const f = await fixture(`<header><button aria-haspopup="listbox" data-automation-id="utilityMenuButton">English</button></header>
    <nav><select required><option value="">Region</option></select></nav><main><h1>Any employer job</h1><button id="apply">Apply</button></main>
    <script>document.querySelector('#apply').onclick=()=>{document.querySelector('main').innerHTML='<label>First Name<input required></label><label>Language proficiency<select required><option value="">Select One</option><option>English</option></select></label>'};</script>`);
  try {
    const result = await f.worker.start(job, { ...options, autoSubmit: false });
    assert.equal(result.state, 'paused');
    assert.deepEqual(result.missing, ['Language proficiency']);
    assert.equal(await f.worker.session.page.locator('main input').inputValue(), 'Test');
    assert.equal(await f.worker.session.page.locator('nav select').inputValue(), '');
    assert.equal(f.store.applicationQuestions(job.id).length, 1);
    assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});
test('utility dropdowns outside headers do not block Apply links or stale-review detection', async () => {
  const f = await fixture(`<button aria-haspopup="listbox" data-automation-id="utilityMenuButton">English</button><main><h1>Job</h1><a href="#" id="apply">Apply</a></main>
    <script>document.querySelector('#apply').onclick=e=>{e.preventDefault();document.querySelector('main').innerHTML='<label>First Name<input required></label><button id="next">Next</button>';document.querySelector('#next').onclick=()=>{document.querySelector('main').innerHTML='<h1>Review</h1><p id="summary">Original details</p><button>Submit</button>'}};</script>`);
  try {
    const result = await f.worker.start(job, { ...options, autoSubmit: false });
    assert.equal(result.state, 'review');
    await f.worker.session.page.locator('#summary').evaluate(el => el.textContent = 'Changed details');
    const changed = await f.worker.submit(result.revision);
    assert.equal(changed.state, 'paused');
    assert.match(changed.message, /form changed/i);
    assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});
test('Workday recognizes a completed resume upload when the file picker has cleared', async () => {
  const f = await fixture('<section><div role="heading">Resume/CV</div><label>Upload a file (5MB max)*<input type="file" required></label><div>Approved.pdf</div><div>Successfully Uploaded!</div></section>');
  try {
    const result = await f.worker.start(job, { ...options, mode: 'none' });
    const fields = await readWorkdayForm(f.worker.session.page);
    assert.equal(fields[0].prompt, 'Resume');
    assert.equal(fields[0].value, 'Approved.pdf');
    assert.deepEqual(result.missing, []);
  } finally { await f.close(); }
});
test('Workday selected phone chips are values; uncommitted search text is not an answer', async () => {
  const f = await fixture('<label for="code">Country Phone Code*</label><div data-automation-id="multiselectInputContainer"><input id="code" data-uxi-widget-type="selectinput" value="search text"><div data-automation-id="selectedItem"><p data-automation-id="promptOption">United States of America (+1)</p></div></div>');
  try {
    const result = await f.worker.start(job, { ...options, mode: 'none' });
    assert.deepEqual(result.missing, []);
    let fields = await readWorkdayForm(f.worker.session.page); assert.equal(fields[0].searchable, true); assert.equal(fields[0].value, 'United States of America (+1)');
    await f.worker.session.page.locator('[data-automation-id="selectedItem"]').evaluate(el => el.remove());
    fields = await readWorkdayForm(f.worker.session.page); assert.equal(fields[0].value, '');
  } finally { await f.close(); }
});
test('Workday fills basics, uploads selected resume, pauses for unknown answers, handles dropdown and advances to submit once', async () => {
  const f = await fixture(`<label>First Name<input id="first" required></label><label>Email Address<input id="email" required></label><label>Resume<input type="file" id="resume" required></label><button id="next">Save and Continue</button><script>
    document.querySelector('#next').onclick=()=>{document.body.innerHTML='<label>Work authorization?<select required><option value="">Choose</option><option>Yes</option><option>No</option></select></label><label for="source">Source*</label><button id="source" aria-haspopup="listbox" aria-required="true">Select One</button><button id="next">Save and Continue</button>';document.querySelector('#source').onclick=()=>{let o=document.createElement('div');o.role='option';o.textContent='Company website';o.onclick=()=>{document.querySelector('#source').textContent=o.textContent;o.remove()};document.body.append(o)};document.querySelector('#next').onclick=()=>{document.body.innerHTML='<h2>Review application</h2><p>Test Candidate</p><button id="submit">Submit</button>';document.querySelector('#submit').onclick=async()=>{await fetch('/submit',{method:'POST'});document.body.innerHTML='<h1>Application submitted</h1>'}}};
  </script>`);
  try {
    const result = await f.worker.start(job, { ...options, resume: { name: 'test.txt', path: { name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('Test resume') } } });
    assert.equal(result.state, 'paused'); assert.equal(f.submissions(), 0);
    assert.deepEqual(result.missing.sort(), ['Source*', 'Work authorization?']);
    for (const question of f.store.applicationQuestions(job.id)) f.store.saveApplicationQuestion({ ...question, jobId: job.id, answer: question.prompt === 'Source*' ? 'Company website' : 'Yes', state: 'answered' });
    const done = await f.worker.resume(); assert.equal(done.state, 'submitted', JSON.stringify({ message: done.message, missing: done.missing })); assert.equal(f.submissions(), 1);
    assert.equal(f.store.applicationDraft(job.id).state, 'submitted');
    await assert.rejects(f.worker.submit(done.revision)); await assert.rejects(f.worker.resume());
  } finally { await f.close(); }
});
test('Workday leaves credentials untouched; none mode does not fill and medium never automatically advances', async () => {
  const f = await fixture('<label>Email<input id="email"></label><label>Password<input type="password" id="password"></label>');
  try {
    const result = await f.worker.start(job, options); assert.equal(result.state, 'paused'); assert.equal(result.blocker, 'portal_credentials');
    assert.equal(await f.worker.session.page.locator('#email').inputValue(), '');
    assert.equal(await f.worker.session.page.locator('#password').inputValue(), '');
    await f.worker.session.page.setContent('<label>First Name<input required></label><button>Save and Continue</button>');
    f.worker.session.public.mode = 'none'; await f.worker.resume(); assert.equal(await f.worker.session.page.locator('input').inputValue(), '');
    f.worker.session.public.mode = 'medium'; const result2 = await f.worker.resume(); assert.equal(result2.state, 'paused');
    assert.equal(await f.worker.session.page.locator('input').inputValue(), 'Test'); assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});
test('account creation checks employer password requirements before sending credentials', async () => {
  const f = await fixture('<h1>Create Account</h1><p>Password requires a lowercase and uppercase character.</p><label>Email<input type="email"></label><label>Password<input type="password"></label><label>Verify New Password<input type="password"></label><button>Create Account</button>');
  try {
    f.worker.accountCredentials = async () => ({ email: options.email, password: '123456789!' });
    const result = await f.worker.start(job, options);
    assert.equal(result.blocker, 'password_requirements');
    assert.equal(result.state, 'paused');
    for (const input of await f.worker.session.page.locator('input').all()) assert.equal(await input.inputValue(), '');
    assert.equal(f.submissions(), 0);
    assert.ok(!JSON.stringify(result).includes('123456789!'));
  } finally { await f.close(); }
});
test('saved credentials pass an account gate and continue to review without exposing passwords', async () => {
  const f = await fixture(`<h1>Create Account</h1><label>Email<input type="email"></label><label>Password<input type="password"></label><label>Verify New Password<input type="password"></label><button id="create">Create Account</button><script>document.querySelector('#create').onclick=()=>{const p=[...document.querySelectorAll('input[type=password]')];if(p[0].value && p[0].value===p[1].value)document.body.innerHTML='<label>First Name<input required></label><button>Submit</button>'};</script>`);
  try {
    f.worker.accountCredentials = async () => ({ email: options.email, password: 'Unit-Test-Only-Secret1!' });
    const result = await f.worker.start(job, { ...options, autoSubmit: false });
    assert.equal(result.state, 'review', result.message);
    assert.equal(await f.worker.session.page.locator('input').inputValue(), 'Test');
    assert.equal(f.submissions(), 0);
    assert.ok(!JSON.stringify(f.store.get('greenhouseSession')).includes('Unit-Test-Only-Secret1!'));
    assert.equal(f.store.applicationQuestions(job.id).length, 0);
  } finally { await f.close(); }
});
test('Workday detects stalled navigation and rejects employer origin changes', async () => {
  const f = await fixture('<label>First Name<input required></label><button>Save and Continue</button>');
  try {
    const result = await f.worker.start(job, options); assert.equal(result.state, 'paused'); assert.match(result.message, /did not advance/);
    await f.worker.session.page.goto('https://other.wd5.myworkdayjobs.com/job');
    await assert.rejects(f.worker.resume(), /another website/); assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});
test('Workday fills offscreen split date inputs using keyboard events and declines survey choices', async () => {
  const f = await fixture(`<fieldset><legend>What is your projected/approximate graduation date?*</legend>
    <label>Month<input id="month" data-automation-id="dateSectionMonth-input" style="position:absolute;left:-10000px"></label>
    <label>Day<input id="day" data-automation-id="dateSectionDay-input" style="position:absolute;left:-10000px"></label>
    <label>Year<input id="year" data-automation-id="dateSectionYear-input" style="position:absolute;left:-10000px"></label></fieldset>
    <label>Please select your gender.*<select required><option value="">Select One</option><option>Woman</option><option>I prefer not to disclose</option></select></label>
    <script>window.keyEvents=0;document.addEventListener('keydown',e=>{window.keyEvents++;if(e.target.tagName==='INPUT' && ['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.target.value=Number(e.target.value || (e.target.id==='year' ? 2026 : 0))+(e.key==='ArrowUp'?1:-1)}});</script>`);
  try {
    f.store.set('profile', { approved: true, hash: 'reviewed' });
    f.store.set('applicationFacts', { reviewed: true, profileHash: 'reviewed', graduationMonth: '2027-05', approximateGraduationDay: '01' });
    f.store.set('demographicPreference', { choice: 'decline' });
    const result = await f.worker.start(job, { ...options, mode: 'medium' });
    assert.deepEqual(result.missing, []);
    assert.equal(await f.worker.session.page.locator('#month').inputValue(), '05');
    assert.equal(await f.worker.session.page.locator('#day').inputValue(), '01');
    assert.equal(await f.worker.session.page.locator('#year').inputValue(), '2027');
    assert.equal(await f.worker.session.page.locator('select').inputValue(), 'I prefer not to disclose');
    assert.ok(await f.worker.session.page.evaluate(() => window.keyEvents) >= 8);
  } finally { await f.close(); }
});
