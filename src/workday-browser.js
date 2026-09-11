import { chromium } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.js';
import { GreenhouseBrowser, questionKey } from './greenhouse-browser.js';
import { UserFacingError, logError } from './errors.js';
import { employerHistoryQuestion } from './answer-defaults.js';
import { demographicPrompt, declineChoice, factAnswer } from './application-facts.js';
import { routinePolicyAnswer, isApplicationTermsPrompt, standingApplicationTermsAnswer } from './application-consent.js';
import { portalCredentials } from './portal-account.js';
import { workflowStatus, classifyRequiredFields } from './workflow-status.js';
import { isSourceSurvey, chooseSourceOption } from './survey-defaults.js';

const controls = 'input,textarea,select,button[aria-haspopup="listbox"],[role="combobox"]';
const digest = fields => createHash('sha256').update(JSON.stringify(fields)).digest('hex');
export function workdayUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !/^[a-z0-9-]+(?:\.wd\d+)?\.myworkdayjobs\.com$/i.test(u.hostname)) throw new UserFacingError('Choose a direct employer myworkdayjobs.com posting. Other Workday site types are not supported yet.');
  return u;
}
export async function readWorkdayForm(frame) {
  return frame.locator(controls).evaluateAll(elements => elements.map((el, index) => {
    const clean = node => { if (!node) return ''; const copy = node.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(child => child.remove()); return (copy.textContent || '').replace(/\s+/g, ' ').trim(); };
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => clean(document.getElementById(id))).join(' ').trim();
    const container = el.closest('[data-automation-id^="formField-"]');
    const siteControl = !!el.closest('header,nav,[role="banner"],[role="navigation"],[role="search"]') || ['utilityMenuButton', 'searchBox', 'searchInput'].includes(el.getAttribute('data-automation-id'));
    let label = [...(el.labels || [])].map(clean).join(' ') || el.getAttribute('aria-label') || labelled || clean(container?.querySelector('label'));
    let uploadedResume = '';
    if (el.type === 'file') {
      let parent = el.parentElement;
      for (let depth = 0; parent && depth < 12; depth++, parent = parent.parentElement) {
        if (parent.querySelectorAll('input[type="file"]').length > 1) break;
        if ([...parent.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-automation-id="sectionHeader"]')].some(h => /^(resume|resume\s*\/\s*cv|cv)\s*\*?$/i.test(clean(h)))) {
          label = 'Resume';
          if (/Successfully Uploaded!/i.test(parent.innerText)) uploadedResume = parent.innerText.split('\n').map(s => s.trim()).filter(s => /\.(pdf|docx?|txt)$/i.test(s)).join(', ');
          break;
        }
      }
    }
    const group = el.closest('fieldset,[role="radiogroup"]');
    const prompt = clean(group?.querySelector('legend')) || group?.getAttribute('aria-label') || label;
    const type = el.type || '';
    const searchable = el.getAttribute('data-uxi-widget-type') === 'selectinput';
    const dropdown = searchable || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox';
    let value = type === 'password' ? '' : type === 'file' ? [...el.files].map(f => f.name).join(', ') : type === 'checkbox' ? (el.checked ? 'checked' : '') : type === 'radio' ? (elements.some(other => other.type === 'radio' && other.name === el.name && other.form === el.form && other.checked) ? 'selected' : '') : el.value || (dropdown ? clean(el) : '');
    if (dropdown && el.tagName === 'BUTTON') value = clean(el);
    if (dropdown && /^(select( one)?|please select|choose( one)?)(\.\.\.)?$/i.test(value)) value = '';
    if (searchable) value = [...(el.closest('[data-automation-id="multiselectInputContainer"]')?.querySelectorAll('[data-automation-id="selectedItem"] [data-automation-id="promptOption"]') || [])].map(clean).join('; ');
    if (uploadedResume) value = uploadedResume;
    return { index, siteControl, id: el.id, name: el.name || '', automation: el.getAttribute('data-automation-id') || '', label, prompt, type, tag: el.tagName.toLowerCase(), dropdown, searchable, value, required: !!el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(prompt) || !!container?.querySelector('[data-automation-id="requiredIndicator"]'), visible: !el.closest('[aria-hidden="true"]') && !!el.getClientRects().length, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', options: el.options ? [...el.options].map(o => ({ label: o.label, value: o.value, disabled: o.disabled })) : [] };
  }));
}
const basics = new Map(Object.entries({ 'first name': 'firstName', 'given name': 'firstName', 'last name': 'lastName', 'family name': 'lastName', 'email': 'email', 'email address': 'email', 'phone number': 'phone', 'city': 'city', 'state': 'state', 'address line 1': 'addressLine1', 'address line 2': 'addressLine2', 'postal code': 'postalCode', 'zip code': 'postalCode', 'linkedin': 'linkedin', 'linkedin profile': 'linkedin' }));

export class WorkdayBrowser extends GreenhouseBrowser {
  update(state, message, extra = {}) {
    return super.update(state, message, { ...workflowStatus(state, extra.blocker || null), ...extra });
  }
  answerFor(field, answers = this.answers()) {
    const s = this.session;
    const termsAnswer = standingApplicationTermsAnswer({ prompt: field.prompt, text: s.applicationTermsText, mode: s.public?.mode, preference: this.store.get('applicationConsent'), profileApproved: this.store.get('profile')?.approved });
    if (termsAnswer) return termsAnswer;
    if (demographicPrompt.test(field.prompt) && this.store.get('demographicPreference')?.choice === 'decline') return 'Prefer not to answer';
    if (field.required && isSourceSurvey(field.prompt) && this.store.get('applicationPreferences')?.sourceSurveyDefaults) return '__source_survey_default__';
    if (questionKey(field.prompt) === 'phone device type') return s.values.phoneType || null;
    const basic = s.values[basics.get(questionKey(field.prompt))];
    if (basic) return basic;
    return factAnswer({ field, job: s.job, profile: this.store.get('profile'), facts: this.store.get('applicationFacts') }) ?? (/^dateSection/.test(field.automation) ? null : answers.get(questionKey(field.prompt))) ?? routinePolicyAnswer(field.prompt, this.store.get('applicationConsent')) ?? s.values[basics.get(questionKey(field.prompt))];
  }
  accountCredentials(email) { return portalCredentials(this.store, email); }
  async authenticate(frame) {
    const s = this.session;
    const credentials = await this.accountCredentials(s.public.email);
    if (!credentials) return this.update('paused', 'Save your portal email and password in Profile and enable account automation, then Resume.', { blocker: 'portal_credentials', missing: [] });
    const passwords = frame.locator('input[type="password"]:visible');
    const count = await passwords.count();
    const creating = count === 2;
    const accountStage = creating ? 'create' : 'sign_in';
    s.authAttempts ??= new Set();
    if (s.authAttempts.has(accountStage)) return this.update('paused', 'The employer has not completed account sign-in. Check the browser for verification instructions or a rejected password. No repeated login attempts will be made.', { blocker: 'portal_sign_in', missing: [] });
    const text = await frame.locator('body').innerText();
    if (creating && ((/lowercase/i.test(text) && !/[a-z]/.test(credentials.password)) || (/uppercase/i.test(text) && !/[A-Z]/.test(credentials.password)) || (/alphabetic/i.test(text) && !/[a-z]/i.test(credentials.password)))) return this.update('paused', 'This employer requires letters in the account password, including uppercase/lowercase where shown. Update your portal password in Profile; it has not been sent.', { blocker: 'password_requirements', missing: [] });
    const emails = frame.locator('input[type="email"]:visible,input[data-automation-id="email"]:visible');
    const buttons = await this.buttons(frame, creating ? /^create account$/i : /^sign in$/i);
    if (![1, 2].includes(count) || await emails.count() !== 1 || buttons.length !== 1) return this.update('paused', 'The account controls are unclear. Complete sign-in in the browser, then Resume.', { blocker: 'portal_sign_in' });
    s.verifyingCode = true; // Suppress browser previews while credentials are entered.
    try {
      if (!await emails.isDisabled()) await emails.fill(credentials.email);
      else if (await emails.inputValue() !== credentials.email) throw new Error('Account email mismatch');
      for (const input of await passwords.all()) await input.fill(credentials.password);
      const consent = frame.getByRole('checkbox', { name: /consent to the terms and conditions/i });
      if (creating && await consent.count()) {
        if (!this.store.get('applicationConsent')?.routinePolicies || /arbitration|waiv(e|er)\b/i.test(text)) return this.update('paused', 'Review the employer account terms in the browser before continuing.', { blocker: 'account_terms' });
        await consent.check();
      }
      s.authAttempts.add(accountStage);
      this.update('signing_in', creating ? 'Creating your employer portal account.' : 'Signing in to your employer portal account.', { blocker: null });
      await buttons[0].click();
      try { await passwords.first().waitFor({ state: 'hidden', timeout: 15000 }); } catch { /* Report the account gate, not completion. */ }
    } catch { return this.update('paused', 'Account sign-in could not finish. Check the employer page and your saved portal credentials.', { blocker: 'portal_sign_in' }); }
    finally {
      for (const input of await passwords.all()) { try { await input.fill(''); } catch { /* Page may have advanced. Never log a credential-entry exception. */ } }
      s.verifyingCode = false;
    }
    s.workdayLoaded = false;
    s.awaitingAccountTransition = !await passwords.count();
    return this.prepare();
  }
  async resume(resume) {
    // An explicit Resume permits another non-submission step attempt after a
    // transient employer error. The base class still prevents resubmission.
    if (!this.busy && this.session && !this.session.submissionAttempted) this.session.steps = new Set();
    return super.resume(resume);
  }
  async inspect(fieldId) {
    return this.exclusive(async () => {
      if (!this.session || this.session.submissionAttempted) throw new UserFacingError('Inspection is available only before submission.');
      const frame = await this.frame();
      if (await frame.locator('input[type="password"]:visible').count()) throw new UserFacingError('Finish sign-in before inspecting application fields.');
      const fields = await this.readFields(frame);
      let options = [];
      if (fieldId) {
        const field = fields.find(f => f.id === fieldId && f.visible);
        if (!field) throw new UserFacingError('That dropdown is not on this step.');
        const el = frame.locator(`[id=${JSON.stringify(fieldId)}]`);
        if (/^dateSection/.test(field.automation)) return { fields, markup: await el.evaluate(e => e.closest('fieldset').outerHTML) };
        if (!field.dropdown) throw new UserFacingError('That field is not a dropdown or date.');
        await el.click();
        try {
          await frame.locator('[role="option"],[data-automation-id="promptOption"]').first().waitFor({ timeout: 3000 });
          options = await frame.locator('[role="option"],[data-automation-id="promptOption"]').allTextContents();
        } finally { await el.press('Escape'); }
      }
      return { fields, options, text: await frame.locator('body').innerText() };
    });
  }
  constructor(store, launch = () => chromium.launchPersistentContext(path.join(DATA, 'workday-automation'), { headless: false })) { super(store, launch); }
  target(job) { if (job?.platform !== 'workday') throw new UserFacingError('Choose a Workday job.'); return workdayUrl(job.url); }
  async readFields(frame) {
    const fields = (await readWorkdayForm(frame)).filter(f => !f.siteControl);
    if (!fields.some(f => f.visible && f.type !== 'hidden')) fields.push({ type: 'review', visible: false, value: await frame.locator('body').innerText() });
    return fields;
  }
  async frame() {
    const s = this.session;
    if (new URL(s.page.url()).origin !== s.origin) throw new UserFacingError('Workday changed to another website. Complete sign-in there yourself and return to the employer application before resuming.');
    return s.page.mainFrame();
  }
  async prepare() {
    const s = this.session; s.reviewDigest = null;
    if (this.pauseBoundary()) return s.public;
    const frame = await this.frame();
    if (s.awaitingAccountTransition) {
      this.update('opening', 'Account step finished. Waiting for the application to load.');
      try {
        await frame.waitForFunction(() => [...document.querySelectorAll('input,textarea,select')].some(el => el.type !== 'hidden' && !el.closest('header,nav,[role="banner"],[role="navigation"],[role="search"]') && el.getClientRects().length) || [...document.querySelectorAll('button,a')].some(el => /^(apply( manually| now)?|submit( application)?)$/i.test(el.textContent.trim())), null, { timeout: 15000 });
        s.awaitingAccountTransition = false;
      } catch { return this.update('paused', 'Your account step finished, but the application has not loaded. Resume to check again.', { blocker: 'page_loading' }); }
    }
    if (!s.workdayLoaded) {
      this.update('opening', 'Waiting for Workday to load the application page.');
      try { await frame.waitForFunction(seen => document.body.innerText.trim() && !/^Loading\s*$/m.test(document.body.innerText) && (document.querySelector('input:not([type="hidden"]),textarea,select') || [...document.querySelectorAll('button,a')].some(el => /^(apply( manually| now)?|create account)$/i.test(el.textContent.trim()) || seen && /^(next|back|submit( application)?)$/i.test(el.textContent.trim())) || /no longer available/i.test(document.body.innerText)), !!s.workdayFormSeen, { timeout: 15000 }); }
      catch { return this.update('paused', 'Workday is still loading. Wait for the page to appear in the browser, then Resume.'); }
      s.workdayLoaded = true;
    }
    if (await frame.locator('iframe[title*="challenge"]:visible,iframe[title*="CAPTCHA"]:visible').count()) return this.update('paused', 'Complete the employer security check in the browser, then Resume.', { blocker: 'security_check' });
    if (await frame.locator('input[type="password"]:visible').count()) return s.public.mode === 'none' ? this.update('paused', 'Sign in is required. None mode leaves account fields unchanged.', { blocker: 'portal_credentials' }) : this.authenticate(frame);
    const fields = await this.readFields(frame);
    const termsField = fields.find(f => f.visible && isApplicationTermsPrompt(f.prompt));
    s.applicationTermsText = null;
    if (termsField) {
      const pageText = await frame.locator('body').innerText();
      const heading = pageText.lastIndexOf('Terms and Conditions');
      if (heading >= 0) s.applicationTermsText = pageText.slice(heading + 'Terms and Conditions'.length).split(termsField.prompt.replace(/\*$/, ''))[0].trim();
    }
    const editable = fields.filter(f => (f.visible || f.type === 'file') && (f.dropdown || !['hidden','password','submit','reset'].includes(f.type)) && (f.tag !== 'button' || f.dropdown));
    if (!editable.length) {
      if (s.workdayFormSeen && (await this.buttons(frame, /^(submit application|submit)$/i)).length === 1) return this.ready(frame, fields);
      if (s.public.mode !== 'full') return this.update('paused', 'Open the Workday application form in the browser, then Resume.');
      for (const name of [/^apply( now)?$/i, /^apply manually$/i]) {
        const choices = await this.buttons(frame, name);
        for (const link of await frame.getByRole('link', { name }).all()) if (await link.isVisible()) choices.push(link);
        if (choices.length === 1) {
          s.openingSteps ??= 0;
          if (++s.openingSteps > 3) return this.update('paused', 'Workday has not opened the application. Check the browser and resume when the form is ready.');
          this.update('advancing', 'Opening the Workday application.'); await choices[0].click(); s.workdayLoaded = false; await s.page.waitForTimeout(900); return this.prepare();
        }
      }
      return this.update('paused', 'Open the Workday application or complete sign-in, then Resume.');
    }
    this.update('reading', 'Reading this Workday application step.');
    s.workdayFormSeen = true;
    const answers = this.answers(); const issues = []; const actions = [];
    if (s.public.mode !== 'none') for (const field of editable) {
      if (this.pauseBoundary()) return s.public;
      const datePart = /^dateSection(Month|Day|Year)-input$/.test(field.automation);
      if (field.disabled || (field.value && !datePart && !employerHistoryQuestion(field.prompt, s.job.company))) continue;
      const repeated = !datePart && editable.filter(f => questionKey(f.prompt) === questionKey(field.prompt) && f.type !== 'radio').length > 1;
      if (repeated) { if (field.required) issues.push('Complete repeated “' + (field.prompt || 'unlabeled') + '” fields in the browser.'); continue; }
      const fresh = await this.readFields(frame);
      const current = field.id ? fresh.find(f => f.id === field.id) : fresh.find(f => f.index === field.index);
      if (!current || current.prompt !== field.prompt || current.type !== field.type || current.automation !== field.automation) { issues.push(field.prompt || 'A field changed while filling'); continue; }
      const el = field.id ? frame.locator(`[id=${JSON.stringify(field.id)}]`) : frame.locator(controls).nth(field.index);
      const declining = demographicPrompt.test(field.prompt) && this.store.get('demographicPreference')?.choice === 'decline';
      let value = this.answerFor(field, answers) ?? await this.defaultAnswer(field.prompt);
      if (employerHistoryQuestion(field.prompt, s.job.company) && value == null) { issues.push(field.prompt); continue; }
      try {
        if (field.type === 'file') {
          if (s.resume && /resume|curriculum vitae|\bcv\b/i.test(field.prompt + ' ' + field.automation)) {
            const file = typeof s.resume.path === 'string' ? { name: s.resume.name, mimeType: /\.pdf$/i.test(s.resume.name) ? 'application/pdf' : 'application/octet-stream', buffer: await fs.readFile(s.resume.path) } : s.resume.path;
            this.update('uploading', 'Uploading your selected resume to Workday.'); await el.setInputFiles(file);
            if (!await el.evaluate(input => input.files?.length > 0)) await frame.waitForFunction(({ id, name }) => {
              const input = document.getElementById(id);
              return input?.files?.length || document.body.innerText.includes(name) && document.body.innerText.includes('Successfully Uploaded!');
            }, { id: field.id, name: s.resume.name }, { timeout: 15000 });
            actions.push('Attached selected resume');
          }
          continue;
        }
        if (value == null || value === '') continue;
        this.update('filling', 'Filling ' + field.prompt + '.');
        if (field.type === 'radio') {
          if (!(declining ? declineChoice.test(field.label) : questionKey(field.label) === questionKey(value))) continue;
          try { await el.check(); } catch (error) { if (!await el.isChecked()) { await el.focus(); await el.press('Space'); } if (!await el.isChecked()) throw error; }
          value = field.label;
        }
        else if (field.type === 'checkbox') { if (/^(yes|no|true|false)$/i.test(value)) await el.setChecked(/^(yes|true)$/i.test(value)); else issues.push(field.prompt); }
        else if (field.tag === 'select') {
          if (value === '__source_survey_default__') value = chooseSourceOption(field.options.filter(o => !o.disabled && o.value).map(o => o.label));
          const matches = field.options.filter(o => !o.disabled && (declining ? declineChoice.test(o.label) : questionKey(o.label) === questionKey(value)));
          if (matches.length !== 1) { if (field.required) issues.push(field.prompt); continue; } await el.selectOption({ value: matches[0].value }); value = matches[0].label;
        } else if (field.dropdown) {
          if (field.searchable) {
            const container = el.locator('xpath=ancestor::*[@data-automation-id="multiselectInputContainer"]');
            await container.locator('[data-automation-id="promptIcon"]').click();
            if (value === '__source_survey_default__') {
              const selectedPath = [];
              for (let depth = 0; depth < 4; depth++) {
                const options = frame.locator('[data-automation-id="promptLeafNode"] [data-automation-id="promptOption"]:visible');
                await options.first().waitFor({ state: 'visible', timeout: 4000 });
                const choice = chooseSourceOption(await options.allTextContents());
                if (!choice) throw new UserFacingError('No source survey options were available.');
                const option = options.filter({ hasText: new RegExp('^' + choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
                if (await option.count() !== 1) throw new UserFacingError('Source survey options were ambiguous.');
                await option.click(); selectedPath.push(choice);
                await s.page.waitForTimeout(200);
                const filled = (await this.readFields(frame)).find(f => f.id === field.id);
                if (filled?.value) break;
              }
              if (!(await this.readFields(frame)).find(f => f.id === field.id)?.value) throw new UserFacingError('The source survey did not retain a selection.');
              value = selectedPath.join(' > ');
            } else if (/^school or university\W*$/i.test(field.prompt)) {
              await el.fill(String(value)); await el.press('Enter');
              await s.page.waitForTimeout(300);
              const selectedSchool = (await this.readFields(frame)).find(f => f.id === field.id)?.value;
              const schoolOptions = frame.locator('[data-automation-id="promptLeafNode"] [data-automation-id="promptOption"]:visible');
              if (selectedSchool === String(value)) { await el.press('Escape'); }
              else {
              await schoolOptions.first().waitFor({ state: 'visible', timeout: 10000 });
              const normalize = text => questionKey(text).replace(/[^a-z0-9]/g, '').replace('atchapelhill', 'chapelhill');
              const labels = await schoolOptions.allTextContents();
              const matches = labels.map((label, index) => ({ label, index })).filter(item => normalize(item.label) === normalize(value));
              if (matches.length !== 1) throw new UserFacingError('The school search did not return one matching institution.');
              await schoolOptions.nth(matches[0].index).click();
              value = matches[0].label;
              }
            } else {
            for (const label of String(value).split(' > ')) {
              const option = frame.locator(`[data-automation-id="promptLeafNode"] [data-automation-id="promptOption"][data-automation-label=${JSON.stringify(label)}]`);
              await option.first().waitFor({ state: 'visible', timeout: 4000 });
              if (await option.count() !== 1) throw new UserFacingError('More than one dropdown option matched.');
              if (this.pauseBoundary()) { await el.press('Escape'); return s.public; }
              await option.click();
            }
            }
            await el.press('Escape');
          } else {
          await el.press('Escape'); await el.click(); await s.page.waitForTimeout(300);
          if (value === '__source_survey_default__') {
            await frame.getByRole('option').first().waitFor({ state: 'visible', timeout: 3000 });
            value = chooseSourceOption(await frame.getByRole('option').allTextContents());
          }
          let option = frame.getByRole('option', { name: declining ? declineChoice : String(value), exact: !declining });
          if (/^are you (at least )?18 years of age or older\?\*?$/i.test(field.prompt) && /^(yes|no)$/i.test(value)) {
            await frame.getByRole('option').first().waitFor({ state: 'visible', timeout: 3000 });
            if (!await option.count()) option = frame.getByRole('option', { name: /^yes$/i.test(value) ? /^Yes, I am (at least )?18 years of age or older\.?$/i : /^No, I am not at least 18 years of age\.?$/i });
          }
          if (questionKey(field.prompt) === 'phone device type' && /^(mobile|cell|cellular|personal cell)$/i.test(value)) {
            await frame.getByRole('option').first().waitFor({ state: 'visible', timeout: 3000 });
            if (!await option.count()) option = frame.getByRole('option', { name: /^(mobile|cell|cellular|personal cell)$/i });
          }
          if (!declining && /^what is your school\?/i.test(field.prompt) && /select .other. if it is not in list/i.test(field.prompt)) {
            await frame.getByRole('option').first().waitFor({ state: 'visible', timeout: 3000 });
            if (!await option.count()) option = frame.getByRole('option', { name: 'Other', exact: true });
          }
          if (await option.count() !== 1 && field.tag === 'input') await el.fill(String(value));
          try { await option.first().waitFor({ state: 'visible', timeout: 3000 }); } catch { await el.press('Escape'); if (field.required) issues.push(field.prompt); continue; }
          if (await option.count() !== 1) { await el.press('Escape'); if (field.required) issues.push(field.prompt); continue; }
          if (this.pauseBoundary()) { await el.press('Escape'); return s.public; }
          value = await option.innerText(); await option.click();
          }
        } else {
          if (datePart) {
            const display = frame.locator(`[id=${JSON.stringify(field.id.replace(/-input$/, '-display'))}]`);
            if (field.id.endsWith('-input') && await display.count() === 1) {
              // The visible segment controls the active date part; focusing its
              // offscreen accessibility input alone does not change that part.
              await display.click();
              await s.page.keyboard.type(String(value), { delay: 100 });
            } else {
              await el.focus(); await el.press('ControlOrMeta+A'); await el.pressSequentially(String(value), { delay: 100 });
            }
            if (Number(await el.inputValue()) !== Number(value)) throw new UserFacingError('The date selection did not retain the expected value.');
          }
          else await el.fill(String(value));
          if (datePart) await s.page.keyboard.press('Tab'); else await el.press('Tab');
        }
        actions.push('Filled ' + field.prompt);
        if (isApplicationTermsPrompt(field.prompt) && value === 'Yes') this.store.event('application_terms_accepted', { jobId: s.job.id, sessionId: s.public.id, prompt: field.prompt, terms: s.applicationTermsText, termsHash: digest(s.applicationTermsText), standingApproval: this.store.get('applicationConsent')?.applicationTerms === true && s.public.mode === 'full' });
        this.store.event('application_answer_used', { jobId: s.job.id, sessionId: s.public.id, prompt: field.prompt, answer: value, historyUpdatedAt: employerHistoryQuestion(field.prompt, s.job.company) ? this.store.get('employmentHistory')?.updatedAt : null });
      } catch (error) { if (field.dropdown) await el.press('Escape').catch(() => {}); logError(error, 'workday:fill'); issues.push(field.prompt || 'An unrecognized field'); }
    }
    const after = await this.readFields(frame);
    for (const f of after.filter(f => f.visible && /^dateSection(Month|Day|Year)-input$/.test(f.automation))) {
      const expected = factAnswer({ field: f, job: s.job, profile: this.store.get('profile'), facts: this.store.get('applicationFacts') });
      if (expected && Number(f.value) !== Number(expected)) issues.push(f.prompt);
    }
    const missing = [...new Set([...issues, ...after.filter(f => (f.visible || f.type === 'file') && f.required && !f.disabled && !f.value && f.type !== 'hidden').map(f => f.prompt || 'Unlabeled required field — complete in browser')])];
    s.public.actions = [...s.public.actions, ...actions].slice(-100);
    const classified = classifyRequiredFields(after, issues, f => f.type === 'file' ? !!s.resume : this.answerFor(f, answers) != null);
    // Conditional controls can appear after selecting an answer. Read them in
    // this run when their answer is known, rather than handing them to the user.
    const newKnown = after.some(f => f.visible && f.required && !f.value && !fields.some(old => old.index === f.index && old.id === f.id && old.prompt === f.prompt) && this.answerFor(f, answers) != null);
    if (newKnown) {
      s.reparsed ??= new Set(); const shape = digest(after.map(f => [f.id, f.index, f.prompt]));
      if (!s.reparsed.has(shape)) { s.reparsed.add(shape); return this.prepare(); }
    }
    for (const prompt of classified.questions) {
      const old = this.store.applicationQuestions(s.job.id).find(q => questionKey(q.prompt) === questionKey(prompt));
      if (!old) this.store.saveApplicationQuestion({ jobId: s.job.id, prompt, answer: '', state: 'needs_answer' });
    }
    for (const question of this.store.applicationQuestions(s.job.id).filter(q => q.state === 'needs_answer')) {
      const completed = after.find(f => f.visible && f.value && questionKey(f.prompt) === questionKey(question.prompt));
      if (completed && !missing.includes(question.prompt)) this.store.saveApplicationQuestion({ id: question.id, jobId: s.job.id, prompt: question.prompt, answer: completed.value, state: 'answered' });
    }
    if (s.public.mode === 'none') return this.update('paused', 'Inspection complete. None mode leaves the Workday form unchanged.', { missing });
    if (missing.length) return this.update('paused', classified.automationIssues.length ? 'Some controls could not be completed automatically. Saved answers are retained; only genuinely missing facts are in your question inbox.' : 'This step needs information that is not in your saved profile. Answer it in the question inbox, then Resume.', { blocker: classified.automationIssues.length ? 'form_controls' : 'missing_facts', missing: classified.questions, automationIssues: classified.automationIssues });
    if (this.pauseBoundary()) return s.public;
    const next = await this.buttons(frame, /^(save and continue|next|continue)$/i);
    if (next.length === 1 && s.public.mode === 'full') {
      const step = await frame.locator('[aria-current="step"]').allTextContents();
      const previous = await frame.locator('h1,h2,[data-automation-id="pageHeaderTitle"]').allTextContents();
      s.steps ??= new Set(); const fingerprint = digest({ fields: after, step, headings: previous });
      if (s.steps.has(fingerprint)) return this.update('paused', 'Workday did not advance. Your answers are saved; check the employer page for validation messages.', { blocker: 'page_validation', missing: [] });
      s.steps.add(fingerprint); this.update('advancing', 'Saving this step and continuing in Workday.', { missing: [] });
      await next[0].click();
      try { await frame.waitForFunction(({ step, previous }) => JSON.stringify([...document.querySelectorAll('[aria-current="step"]')].map(e => e.textContent)) !== JSON.stringify(step) || JSON.stringify([...document.querySelectorAll('h1,h2,[data-automation-id="pageHeaderTitle"]')].map(e => e.textContent)) !== JSON.stringify(previous), { step, previous }, { timeout: 10000 }); } catch { /* Validation is reported on the next inspection; never retry Submit. */ }
      s.workdayLoaded = false; await s.page.waitForTimeout(900); return this.prepare();
    }
    const submit = await this.buttons(frame, /^(submit application|submit|apply now)$/i);
    if (submit.length === 1) {
      return this.ready(frame, after);
    }
    return this.update('paused', s.public.mode === 'medium' ? 'This Workday step is filled. Review it and click Next in the browser, then Resume.' : 'Check the Workday page for any remaining instructions, then Resume.', { missing: [] });
  }
  async ready(frame, fields) {
    const s = this.session;
    s.reviewDigest = digest(fields); s.reviewFrame = frame; s.reviewUrl = frame.url(); s.reviewRevision = randomUUID();
    this.update('review', s.autoSubmit ? 'Workday form is filled. Submitting automatically as requested.' : 'Workday is ready for your final review.', { missing: [], revision: s.reviewRevision });
    return s.autoSubmit ? this.submitReviewed(s.reviewRevision) : s.public;
  }
}
