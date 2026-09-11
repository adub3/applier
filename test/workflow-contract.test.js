import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openStore } from '../src/db.js';
import { WorkdayBrowser } from '../src/workday-browser.js';
import { classifyRequiredFields, workflowStatus } from '../src/workflow-status.js';

test('known-but-broken controls are automation blockers, not questions for the applicant', () => {
  const fields = ['City', 'Postal Code'].map(prompt => ({ prompt, type: 'text', required: true, visible: true, value: '' }));
  assert.deepEqual(classifyRequiredFields(fields, [], f => f.prompt === 'City'), { questions: ['Postal Code'], automationIssues: ['City'] });
  assert.equal(workflowStatus('review').completion, 'not_submitted');
  assert.equal(workflowStatus('email_verification').completion, 'pending_confirmation');
  assert.equal(workflowStatus('submitted').completion, 'confirmed');
});

const job = { id: 'contract', platform: 'workday', company: 'Example', title: 'Analyst', url: 'https://example.wd1.myworkdayjobs.com/Careers/job/Test' };
async function setup(html) {
  const store = openStore(':memory:');
  store.set('profile', { approved: true, city: 'Example City' });
  const browser = await chromium.launch({ headless: true });
  let submissions = 0;
  const worker = new WorkdayBrowser(store, async () => {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (route.request().method() === 'POST') { submissions++; return route.fulfill({ body: 'ok' }); }
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    return context;
  });
  worker.accountCredentials = async email => ({ email, password: 'Test-Only-Secret1!' });
  return { worker, store, count: () => submissions, close: async () => { await browser.close(); store.close(); } };
}
const options = { mode: 'full', autoSubmit: true, email: 'applicant@example.test', firstName: 'Example' };

test('account-to-receipt contract: delayed handoff, conditional fields, upload, submit once, verification', async () => {
  const f = await setup(`<header><button data-automation-id="utilityMenuButton" aria-haspopup="listbox">English</button></header><main><h1>Create Account</h1><label>Email<input type="email"></label><label>Password<input type="password"></label><label>Verify New Password<input type="password"></label><button id="account">Create Account</button></main><script>
    const main=document.querySelector('main');
    document.querySelector('#account').onclick=()=>{main.innerHTML='<p>Loading</p>';setTimeout(()=>{
      main.innerHTML='<h1>My Information</h1><label>First Name<input required></label><label>Country<select id="country" required><option value="">Select One</option><option>Example Country</option></select></label><label>Resume<input type="file" required></label><button id="next">Next</button>';
      document.querySelector('#country').onchange=()=>document.querySelector('#country').insertAdjacentHTML('afterend','<label>City<input id="city" required></label>');
      document.querySelector('#next').onclick=()=>{if(!document.querySelector('#city')?.value)return;main.innerHTML='<h1>Review</h1><p>Example Applicant</p><button id="submit">Submit</button>';document.querySelector('#submit').onclick=async()=>{await fetch('/application',{method:'POST'});main.innerHTML='<h1>Thank you for applying. Verify your email</h1><input autocomplete="one-time-code"><button id="verify">Verify code</button>';document.querySelector('#verify').onclick=()=>{if(document.querySelector('input').value==='123456')main.innerHTML='<h1>Application received</h1>'}}};
    },500)};
  </script>`);
  try {
    f.store.saveReusableAnswer('country', 'Country', 'Example Country');
    const result = await f.worker.start(job, { ...options, resume: { name: 'test.txt', path: { name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('Test resume') } } });
    assert.equal(result.state, 'email_verification', JSON.stringify({ message: result.message, missing: result.missing, issues: result.automationIssues, actions: result.actions }));
    assert.equal(f.count(), 1);
    assert.equal(f.store.applicationQuestions(job.id).length, 0);
    assert.equal(f.store.applicationDraft(job.id).state, 'submission_unknown');
    const done = await f.worker.verifyEmail('123456');
    assert.equal(done.completion, 'confirmed');
    assert.equal(f.count(), 1);
    await assert.rejects(f.worker.submit(done.revision));
    assert.ok(!JSON.stringify(f.store.get('greenhouseSession')).includes('Test-Only-Secret1!'));
  } finally { await f.close(); }
});

test('an account popup after Submit is not proof of acceptance or required email verification', async () => {
  const f = await setup(`<label>First Name<input required></label><button id="submit">Submit</button><script>document.querySelector('#submit').onclick=async()=>{await fetch('/application',{method:'POST'});document.body.innerHTML='<h1>Create Account</h1><p>Check your email to verify your account.</p><input type="password"><button>Create Account</button>'};</script>`);
  try {
    const result = await f.worker.start(job, options);
    assert.equal(result.state, 'submission_unknown');
    assert.equal(result.completion, 'pending_confirmation');
    assert.equal(f.count(), 1);
    await assert.rejects(f.worker.resume());
    assert.equal(f.count(), 1);
  } finally { await f.close(); }
});
test('creation followed by a separate sign-in is a new stage, not a failed duplicate attempt', async () => {
  const f = await setup(`<h1>Create Account</h1><input type="email"><input type="password"><input type="password"><button id="create">Create Account</button><script>
    document.querySelector('#create').onclick=()=>{document.body.innerHTML='<h1>Sign In</h1><input type="email"><input type="password"><button id="login">Sign In</button>';document.querySelector('#login').onclick=()=>{document.body.innerHTML='<h1>Application</h1><label>First Name<input required></label><button>Submit</button>'}};
  </script>`);
  try {
    const result = await f.worker.start(job, { ...options, autoSubmit: false });
    assert.equal(result.state, 'review', result.message);
    assert.equal(f.worker.session.authAttempts.size, 2);
    assert.equal(f.count(), 0);
  } finally { await f.close(); }
});
