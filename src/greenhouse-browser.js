import { chromium } from 'playwright';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DATA } from './config.js';
import { UserFacingError, publicError, logError } from './errors.js';
import { priorEmployerDefault, employerHistoryQuestion } from './answer-defaults.js';
import { factAnswer, demographicPrompt, declineChoice } from './application-facts.js';

export const questionKey = text => String(text || '').replace(/^Portal question:\s*/i, '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/\s*\*$/, '').trim();
export function greenhouseUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(u.hostname)) throw new UserFacingError('Use a direct Greenhouse posting URL.');
  return u;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receiptText = /thank you for applying|application (has been |was )?(successfully )?(submitted|received)/i;
const emailCheckText = /verify your email|verify (your )?email address|email verification|verification code|check your (email|inbox)|code (we |was |has been )?sent|sent (you )?(a )?code/i;
const codeSelector = 'input[autocomplete="one-time-code"]:visible,input[name*="verification" i]:visible,input[name*="otp" i]:visible,input[id*="verification" i]:visible,input[aria-label*="verification code" i]:visible,input[placeholder*="code" i]:visible';
const demographicQuestion = new RegExp(demographicPrompt.source + '|^(are you Hispanic/Latino|do you have a disability or chronic condition)', 'i');
const declineOption = declineChoice;
const profileKeys = new Map(Object.entries({ 'first name': 'firstName', first_name: 'firstName', 'last name': 'lastName', last_name: 'lastName', 'full name': 'name', email: 'email', 'email address': 'email', phone: 'phone', 'phone number': 'phone', linkedin: 'linkedin', 'linkedin profile': 'linkedin', 'linkedin url': 'linkedin' }));

export async function readForm(frame) {
  return frame.locator('input,textarea,select,[role="combobox"]').evaluateAll(elements => elements.map((el, index) => {
    const text = e => { if (!e) return ''; const copy = e.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(child => child.remove()); return (copy.textContent || '').replace(/\s+/g, ' ').trim(); };
    const labelled = e => (e.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(document.getElementById(id))).join(' ').trim();
    const label = el.type === 'file' && ['resume','cover_letter'].includes(el.id) ? (el.id === 'resume' ? 'Resume' : 'Cover letter') : [...(el.labels || [])].map(text).join(' ') || el.getAttribute('aria-label') || labelled(el) || '';
    const group = el.closest('fieldset,[role="radiogroup"]');
    const groupLabel = group ? text(group.querySelector('legend')) || group.getAttribute('aria-label') || labelled(group) : '';
    const type = (el.type || '').toLowerCase();
    const groupSelected = type === 'radio' && elements.some(other => other.type === 'radio' && other.name === el.name && other.form === el.form && other.checked);
    const shell = el.closest('.select-shell');
    const selected = shell ? [...shell.querySelectorAll('.select__single-value,.select__multi-value__label')].map(text).join('; ') : '';
    return { index, id: el.id, label, prompt: groupLabel || label, name: el.name || '', type, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), visible: !el.closest('[aria-hidden="true"]') && !!el.getClientRects().length, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', required: !!el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(groupLabel || label), value: type === 'password' ? '' : type === 'radio' ? (groupSelected ? 'selected' : '') : type === 'checkbox' ? (el.checked ? 'checked' : '') : type === 'file' ? [...el.files].map(f => f.name).join(', ') : shell ? selected : el.value || '', options: el.options ? [...el.options].map(o => ({ label: o.label, value: o.value, disabled: o.disabled })) : [] };
  }));
}

export class GreenhouseBrowser {
  constructor(store, launch = () => chromium.launchPersistentContext(path.join(DATA, 'greenhouse-automation'), { headless: false })) {
    this.store = store; this.launch = launch; this.session = null; this.busy = false;
  }
  state() { return this.session?.public || this.store.get('greenhouseSession'); }
  target(job) { if (job?.platform !== 'greenhouse') throw new UserFacingError('Choose a Greenhouse job.'); return greenhouseUrl(job.url); }
  readFields(frame) { return readForm(frame); }
  async inspect(fieldId) {
    return this.exclusive(async () => {
      if (!this.session || this.session.submissionAttempted) throw new UserFacingError('Inspection is available only before submission.');
      const frame = await this.frame();
      if (await frame.locator('input[type="password"]:visible').count()) throw new UserFacingError('Finish sign-in before inspecting application fields.');
      const fields = await this.readFields(frame); let options = [];
      if (fieldId) {
        const field = fields.find(f => f.id === fieldId && f.visible);
        if (!field || field.role !== 'combobox') throw new UserFacingError('That dropdown is not on this form.');
        const el = frame.locator(`[id=${JSON.stringify(fieldId)}]`);
        await el.click();
        try { await frame.getByRole('option').first().waitFor({ timeout: 3000 }); options = await frame.getByRole('option').allTextContents(); }
        finally { await el.press('Escape'); }
      }
      return { fields, options, text: await frame.locator('body').innerText() };
    });
  }
  answerFor(field, answers = this.answers()) {
    const s = this.session;
    if (demographicQuestion.test(field.prompt) && this.store.get('demographicPreference')?.choice === 'decline') return 'Prefer not to answer';
    if (field.id === 'country') return s.values.phoneCountry;
    if (field.id === 'candidate-location' && s.values.city && s.values.state) return [s.values.city, s.values.state, s.job.scope === 'US' ? 'United States' : null].filter(Boolean).join(', ');
    const key = profileKeys.get(questionKey(field.label)) || (!field.label ? profileKeys.get(field.name) : null);
    return factAnswer({ field, job: s.job, profile: this.store.get('profile'), facts: this.store.get('applicationFacts') }) ?? (key ? s.values[key] : null) ?? answers.get(questionKey(field.prompt));
  }
  async defaultAnswer(prompt) {
    return priorEmployerDefault({ prompt, company: this.session.job.company, history: this.store.get('employmentHistory') });
  }
  async preview() {
    if (!this.session || this.session.page.isClosed()) return { image: null };
    if (this.session.verifyingCode) return { image: null };
    try { return { image: 'data:image/jpeg;base64,' + (await this.session.page.screenshot({ type: 'jpeg', quality: 55, timeout: 3000 })).toString('base64') }; }
    catch { return { image: null }; }
  }
  pause() {
    if (!this.session) throw new UserFacingError('Start a browser session first.');
    if (this.session.submissionAttempted) throw new UserFacingError('The application has already been sent. Complete email verification or check its result; do not submit again.');
    this.session.pauseRequested = true;
    this.session.reviewDigest = null;
    return this.update(this.busy ? 'pausing' : 'manual', this.busy ? 'Finishing the current action, then handing control to you. Please wait.' : 'Automation is paused. You can use the employer browser now. Click Resume when finished.');
  }
  pauseBoundary() {
    if (!this.session?.pauseRequested) return false;
    this.update('manual', 'Automation is paused. You can use the employer browser now. Click Resume when finished.');
    return true;
  }
  update(state, message, extra = {}) {
    const s = this.session;
    const at = new Date().toISOString();
    const history = [...(s.public.history || []), { at, message }].slice(-60);
    s.public = { ...s.public, state, message, userFacing: true, ...extra, updatedAt: at, history };
    this.store.set('greenhouseSession', s.public);
    this.store.event('application_browser', { jobId: s.job.id, state, message });
    const status = s.submissionAttempted && state !== 'submitted' ? 'submission_unknown' : { review: 'ready_for_review', submitted: 'submitted', submitting: 'submission_unknown', submission_unknown: 'submission_unknown', stopped: 'paused', paused: 'paused' }[state] || 'in_progress';
    this.store.saveApplicationDraft(s.job.id, status, this.store.applicationDraft(s.job.id)?.notes || '');
    return s.public;
  }
  async exclusive(work) {
    if (this.busy) throw new UserFacingError('The browser is busy. Wait for the current action.');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
  async start(job, { mode, email, firstName, lastName, resume, autoSubmit = false } = {}) {
    return this.exclusive(async () => {
      if (this.session) throw new UserFacingError('Close the current browser session first.');
      const target = this.target(job);
      if (!['none', 'medium', 'full'].includes(mode)) throw new UserFacingError('Choose an automation level.');
      if (['submitted', 'submission_unknown', 'done'].includes(this.store.applicationDraft(job.id)?.state)) throw new UserFacingError('This application is already submitted, closed, or awaiting confirmation. Check its tracker before starting again.');
      const profile = this.store.get('profile');
      if (!profile?.approved) throw new UserFacingError('Review your profile and mark it accurate first.');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserFacingError('Enter the email to use for this application.');
      let context;
      try { context = await this.launch(); }
      catch (error) {
        logError(error, 'application-browser:launch');
        throw new UserFacingError(/Executable doesn't exist|download new browsers/i.test(error.message)
          ? 'The application browser is not installed yet. Browser setup needs to finish before you can start an application.'
          : 'The application browser could not open. Close any previous application browser window and try again.');
      }
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      this.session = { context, page, job, origin: target.origin, resume, values: { ...profile, email, firstName, lastName }, public: { id: randomUUID(), jobId: job.id, company: job.company, title: job.title, mode, email, resume: resume?.name || null, actions: [] } };
      this.session.autoSubmit = mode === 'full' && autoSubmit === true;
      this.session.public.autoSubmit = this.session.autoSubmit;
      context.on('close', () => {
        if (this.session?.context === context) { if (!['submitted','submission_unknown'].includes(this.session.public.state)) this.update('stopped', 'Browser closed.'); this.session = null; }
      });
      this.update('opening', job.platform === 'workday' ? 'Opening Workday.' : 'Opening Greenhouse.');
      try { await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 }); return await this.prepare(); }
      catch (e) { const report = publicError(e, 'application-browser:prepare', 'The application page could not be prepared. Check the browser window, then try Resume.'); return this.update('paused', report.error, { reference: report.reference }); }
    });
  }
  async frame() {
    const s = this.session;
    if (new URL(s.page.url()).origin !== s.origin) throw new UserFacingError('The browser changed employer origin. Inspect the page before continuing.');
    for (const frame of s.page.frames()) {
      if (!frame.url().startsWith(s.origin + '/')) continue;
      if (await frame.locator('input[name="first_name"],input[name="email"],#first_name,#email').count()) return frame;
    }
    return s.page.mainFrame();
  }
  answers() {
    const answers = new Map();
    // Use the full prompt, not the legacy punctuation-stripped database key.
    for (const a of this.store.reusableAnswers()) answers.set(questionKey(a.prompt), a.answer);
    for (const a of this.store.applicationQuestions(this.session.job.id)) if (a.state === 'answered' && a.answer) answers.set(questionKey(a.prompt), a.answer);
    if (this.store.get('demographicPreference')?.choice === 'decline') {
      for (const a of this.store.applicationQuestions(this.session.job.id)) if (demographicQuestion.test(a.prompt)) answers.set(questionKey(a.prompt), 'Prefer not to answer');
    }
    for (const key of answers.keys()) if (/^have you (previously|ever) (worked (for|at)|been employed by) /i.test(key)) answers.delete(key);
    return answers;
  }
  async buttons(frame, regex) {
    const result = [];
    for (const el of await frame.getByRole('button', { name: regex }).all()) if (await el.isVisible() && await el.isEnabled()) result.push(el);
    return result;
  }
  async prepare() {
    const s = this.session; s.reviewDigest = null;
    if (this.pauseBoundary()) return s.public;
    this.update('reading', 'Reading the application fields.');
    const frame = await this.frame();
    if (await frame.locator('input[type="password"]:visible,iframe[title*="challenge"]:visible').count()) return this.update('paused', 'Complete sign-in or the verification challenge in the browser, then Resume.');
    let fields = await readForm(frame);
    if (!s.formSeen && !fields.some(f => profileKeys.has(questionKey(f.label)) || f.name === 'first_name')) {
      const apply = await this.buttons(frame, /^apply( for this job| now)?$/i);
      if (s.public.mode === 'full' && apply.length === 1 && !s.openedApplication) {
        s.openedApplication = true; await apply[0].click(); await s.page.waitForTimeout(700); return this.prepare();
      }
      return this.update('paused', 'Open the application form in the browser, then Resume.');
    }
    s.formSeen = true;
    const answers = this.answers(); const actions = []; const issues = [];
    if (s.public.mode !== 'none') {
      for (const f of fields) {
        if (this.pauseBoundary()) return s.public;
        if (f.disabled || (f.value && !employerHistoryQuestion(f.prompt, s.job.company)) || (!f.visible && f.type !== 'file')) continue;
        if (['hidden','password','submit','button','reset'].includes(f.type)) continue;
        const fresh = await readForm(frame);
        const current = f.id ? fresh.find(field => field.id === f.id) : fresh[f.index];
        if (!current || current.name !== f.name || current.prompt !== f.prompt || current.type !== f.type) { issues.push(f.prompt || f.name || 'Form changed during filling'); continue; }
        const el = f.id ? frame.locator(`[id=${JSON.stringify(f.id)}]`) : frame.locator('input,textarea,select,[role="combobox"]').nth(f.index);
        const key = profileKeys.get(questionKey(f.label)) || (!f.label ? profileKeys.get(f.name) : null);
        const answer = this.answerFor(f, answers) ?? await this.defaultAnswer(f.prompt);
        const value = answer ?? (key && !['radio','checkbox','file'].includes(f.type) ? s.values[key] : null);
        if (employerHistoryQuestion(f.prompt, s.job.company) && value == null) { issues.push(f.prompt); continue; }
        try {
          if (f.type === 'file') {
            if (s.resume && /^(resume|resume\/cv|cv)(\s*\*)?$/i.test(f.label || f.name)) {
              this.update('uploading', 'Uploading your selected resume.');
              const file = typeof s.resume.path === 'string' ? { name: s.resume.name, mimeType: /\.pdf$/i.test(s.resume.name) ? 'application/pdf' : 'application/octet-stream', buffer: await fs.readFile(s.resume.path) } : s.resume.path;
              await el.setInputFiles(file); actions.push('Attached ' + s.resume.name);
            }
            continue;
          }
          if (value == null || value === '') continue;
          this.update('filling', 'Filling ' + (f.prompt || 'a saved field') + '.');
          if (f.type === 'radio') {
            if (questionKey(f.label) !== questionKey(value)) continue;
            await el.check();
          } else if (f.type === 'checkbox') {
            if (!/^(yes|no|true|false)$/i.test(value)) { issues.push(f.prompt); continue; }
            await el.setChecked(/^(yes|true)$/i.test(value));
          } else if (f.tag === 'select') {
            const declining = value === 'Prefer not to answer' && demographicQuestion.test(f.prompt);
            const options = f.options.filter(o => !o.disabled && (questionKey(o.label) === questionKey(value) || declining && declineOption.test(o.label)));
            if (options.length !== 1) { issues.push(f.prompt); continue; }
            await el.selectOption({ label: options[0].label });
          } else if (f.role === 'combobox') {
            await el.click();
            const declining = value === 'Prefer not to answer' && demographicQuestion.test(f.prompt);
            const schoolParts = /^school(?:--0)?$/.test(f.id) ? String(value).split(/\s+at\s+/i) : null;
            const schoolOption = schoolParts?.length === 2 ? new RegExp('^' + schoolParts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ ,–—-]+(?:at[ ,–—-]+)?') + '$', 'i') : null;
            const optionName = declining ? declineOption : schoolOption || (/^degree(?:--0)?$/.test(f.id) && value === 'B.S.' ? /^(Bachelor'?s(?: Degree)?|Bachelor of Science|B\.S\.)$/i : value === 'Yes' && /acknowledge|offers of employment|equal employment opportunity statement/i.test(f.prompt) ? /^Yes(, I acknowledge\.)?$/i : value);
            const options = frame.getByRole('option', { name: optionName, exact: typeof optionName === 'string' }).filter({ visible: true });
            if (await options.count() !== 1 && !declining) { await el.fill(schoolOption ? schoolParts[1] : f.id === 'candidate-location' ? String(value).split(',')[0] : /^degree(?:--0)?$/.test(f.id) && value === 'B.S.' ? 'Bachelor' : String(value)); }
            try { await options.first().waitFor({ state: 'visible', timeout: 5000 }); } catch { await el.press('Escape'); issues.push(f.prompt); continue; }
            if (await options.count() !== 1) { await el.press('Escape'); issues.push(f.prompt); continue; }
            if (this.pauseBoundary()) { await el.press('Escape'); return s.public; }
            await options.click();
            await el.press('Tab');
          } else await el.fill(String(value));
          actions.push('Filled ' + (f.prompt || f.name));
          this.store.event('application_answer_used', { jobId: s.job.id, sessionId: s.public.id, prompt: f.prompt, answer: value, historyUpdatedAt: employerHistoryQuestion(f.prompt, s.job.company) ? this.store.get('employmentHistory')?.updatedAt : null });
        } catch (error) { logError(error, 'application-browser:fill'); issues.push(f.prompt || f.name || 'Unrecognized field'); }
      }
    }
    fields = await readForm(frame);
    if (this.pauseBoundary()) return s.public;
    const missing = [...new Set([...issues, ...fields.filter(f => f.required && !f.disabled && !f.value && (f.visible || f.type === 'file') && !['hidden','submit','button'].includes(f.type)).map(f => f.prompt || f.name || 'Unlabeled required field')])];
    for (const old of this.store.applicationQuestions(s.job.id)) {
      if (old.state === 'needs_answer' && ['Form changed during filling','Attach','Unlabeled required field'].includes(old.prompt) && !missing.includes(old.prompt)) {
        this.store.saveApplicationQuestion({ id: old.id, jobId: s.job.id, prompt: old.prompt, answer: '', state: 'resolved' });
      }
      const filled = fields.find(f => f.id !== 'country' && f.visible && f.value && questionKey(f.prompt) === questionKey(old.prompt));
      if (old.state === 'needs_answer' && filled && !missing.includes(old.prompt)) this.store.saveApplicationQuestion({ id: old.id, jobId: s.job.id, prompt: old.prompt, answer: filled.value, state: 'answered' });
      const optional = fields.find(f => f.visible && !f.required && !f.value && questionKey(f.prompt) === questionKey(old.prompt));
      if (old.state === 'needs_answer' && optional && !missing.includes(old.prompt)) this.store.saveApplicationQuestion({ id: old.id, jobId: s.job.id, prompt: old.prompt, answer: '', state: 'resolved' });
    }
    const existing = new Set(this.store.applicationQuestions(s.job.id).map(q => questionKey(q.prompt)));
    for (const prompt of missing) if (!existing.has(questionKey(prompt))) { this.store.saveApplicationQuestion({ jobId: s.job.id, prompt, answer: '', state: 'needs_answer' }); existing.add(questionKey(prompt)); }
    s.public.actions = [...s.public.actions, ...actions].slice(-100);
    if (s.public.mode === 'none') return this.update('paused', 'Inspection complete. None mode leaves the form under your control.', { missing });
    if (missing.length) return this.update('paused', 'Answer the missing questions or complete the fields in the browser, then Resume.', { missing });
    const next = await this.buttons(frame, /^(next|continue|save and continue)$/i);
    const stepFingerprint = digest({ fields, headings: await frame.locator('h1,h2,[aria-current="step"]').allTextContents() });
    if (s.public.mode === 'full' && next.length === 1 && !s.visited?.has(stepFingerprint)) {
      s.visited ??= new Set();
      this.update('advancing', 'Moving to the next application step.');
      s.visited.add(stepFingerprint); await next[0].click(); await s.page.waitForTimeout(700); return this.prepare();
    }
    const submit = await this.buttons(frame, /^(submit application|submit|apply now)$/i);
    if (submit.length === 1 && fields.length) {
      s.reviewDigest = digest(fields); s.reviewFrame = frame; s.reviewUrl = frame.url(); s.reviewRevision = randomUUID();
      this.update('review', s.autoSubmit ? 'All required fields are filled. Submitting automatically as requested.' : 'Ready. Review the employer form, then confirm submission here.', { missing: [], revision: s.reviewRevision });
      return s.autoSubmit ? this.submitReviewed(s.reviewRevision) : s.public;
    }
    return this.update('paused', 'The final submit control was not recognized. Inspect the browser, then Resume.', { missing: [] });
  }
  async resume(resume) { return this.exclusive(async () => { if (!this.session) throw new UserFacingError('Start a browser session first.'); if (this.session.public.state === 'email_verification') return this.submissionResult(); if (this.session.submissionAttempted || ['submitted','submitting','submission_unknown'].includes(this.session.public.state)) throw new UserFacingError('This submission must be checked before another attempt.'); if (resume) { this.session.resume = resume; this.session.public.resume = resume.name; } this.session.pauseRequested = false; return this.prepare(); }); }
  async submissionResult() {
    const s = this.session;
    const deadline = Date.now() + 15000;
    do {
      const frame = await this.frame();
      const text = await frame.locator('body').innerText();
      const accountForm = await frame.locator('input[type="password"]:visible').count() > 0;
      if (accountForm && !receiptText.test(text)) return this.update('submission_unknown', 'Submit was clicked once. The employer is showing account setup, but no application receipt is confirmed. Account setup may be optional; do not submit again.', { blocker: 'confirmation_pending', codeEntry: false });
      if (accountForm && receiptText.test(text) && /optional|create an account to (track|view)/i.test(text)) return this.update('submitted', 'Employer confirmation detected. Optional account setup is separate.', { codeEntry: false, confirmedAt: new Date().toISOString(), confirmationUrl: s.page.url() });
      // Verification takes precedence: some pages say "thank you" before the email check is complete.
      if (emailCheckText.test(text) && !/email (address )?(has been |is )?(successfully )?verified/i.test(text)) {
        const inputs = frame.locator(codeSelector);
        const codeEntry = await inputs.count() === 1;
        return this.update('email_verification', 'One last step: check ' + s.public.email + ' for the employer’s verification email. ' + (codeEntry ? 'Enter its code below, or complete verification in the employer browser, then click Check verification.' : 'Open the verification link from that email, then click Check verification. If it opens another tab, keep it open; the employer may also need you to refresh the original page.'), { missing: [], revision: null, codeEntry });
      }
      if (receiptText.test(text)) return this.update('submitted', 'Employer confirmation detected.', { codeEntry: false, confirmedAt: new Date().toISOString(), confirmationUrl: s.page.url() });
      await s.page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return this.update('submission_unknown', 'The employer has not confirmed completion yet. Check the employer page and verification email. Your application will not be submitted again automatically.', { codeEntry: false });
  }
  async verifyEmail(code) {
    return this.exclusive(() => this.enterEmailCode(code));
  }
  async checkGmail(gmail) {
    return this.exclusive(async () => {
      const s = this.session;
      if (!s || s.public.state !== 'email_verification' || !s.public.codeEntry) return this.state();
      if (s.mailStopped) return this.state();
      try {
        const code = await gmail.findCode({ email: s.public.email, since: s.submittedAt, company: s.job.company, title: s.job.title });
        if (code) {
          this.update('email_verification', 'Verification email found. Entering its code securely.');
          const result = await this.enterEmailCode(code);
          if (result.state === 'email_verification') { s.mailStopped = true; return this.update('email_verification', 'The employer did not accept or finish verification. Check the code in the employer browser.'); }
          return result;
        }
        return this.update('email_verification', 'Waiting for a matching verification email in connected Gmail. You can also enter the code manually.');
      } catch (error) {
        s.mailStopped = true;
        return this.update('email_verification', error instanceof UserFacingError ? error.message : 'Email checking stopped. Enter the verification code manually or reconnect Gmail.');
      }
    });
  }
  async enterEmailCode(code) {
      const s = this.session;
      if (!s || s.public.state !== 'email_verification') throw new UserFacingError('There is no email verification waiting in this browser.');
      if (typeof code !== 'string' || !/^[a-z0-9 -]{3,32}$/i.test(code.trim())) throw new UserFacingError('Enter the code from the employer’s email.');
      const frame = await this.frame();
      const inputs = frame.locator(codeSelector);
      const buttons = await this.buttons(frame, /^(verify|verify email|verify code|verify email address|confirm code|confirm email|verify and submit|verify & submit)$/i);
      if (await inputs.count() !== 1 || buttons.length !== 1) throw new UserFacingError('The verification controls are unclear. Enter the code directly in the employer browser, then click Check verification.');
      s.verifyingCode = true;
      try {
        await inputs.fill(code.trim());
        await buttons[0].click();
        await s.page.waitForTimeout(700);
        return await this.submissionResult();
      } catch {
        // Playwright errors may include the code in their call log: never persist them.
        throw new UserFacingError('Email verification could not finish. Check the employer page for an expired or incorrect code, then try again.');
      } finally {
        try { if (await inputs.count() === 1) await inputs.fill(''); } catch { /* The verification page may have closed. */ }
        s.verifyingCode = false;
      }
  }
  async submit(revision) {
    return this.exclusive(() => this.submitReviewed(revision));
  }
  async submitReviewed(revision) {
      const s = this.session;
      if (!s || s.public.state !== 'review' || revision !== s.reviewRevision) throw new UserFacingError('Resume and review the current form first.');
      const frame = await this.frame();
      if (frame !== s.reviewFrame || frame.url() !== s.reviewUrl || digest(await this.readFields(frame)) !== s.reviewDigest) return this.update('paused', 'The form changed. Resume to refresh the review.');
      const submit = await this.buttons(frame, /^(submit application|submit|apply now)$/i);
      if (submit.length !== 1) return this.update('paused', 'Submit control changed. Resume to inspect the form.');
      if (await frame.getByText(/thank you for applying|application (has been |was )?(successfully )?(submitted|received)/i).first().isVisible()) return this.update('submission_unknown', 'A previous confirmation is already visible. Check the employer page before another attempt.');
      s.submissionAttempted = true;
      s.submittedAt = Date.now();
      this.update('submitting', 'Submitting once; waiting for the employer confirmation.');
      try {
        await submit[0].click();
        return await this.submissionResult();
      } catch (error) { logError(error, 'application-browser:submit'); return this.update('submission_unknown', 'No confirmation detected. Check the employer page before another attempt; no automatic retry will occur.'); }
  }
  async close() { return this.exclusive(async () => { if (this.session) await this.session.context.close(); return this.state(); }); }
}
