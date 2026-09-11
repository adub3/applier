import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DATA } from './config.js';

const greenhouseHosts = /(^|\.)greenhouse\.io$/i;
const workdayHosts = /(^|\.)myworkdayjobs\.com$/i;
const ignoredTypes = new Set(['hidden', 'password', 'file', 'submit', 'button', 'checkbox', 'radio', 'image', 'reset']);
const aliases = {
  firstName: ['first name', 'given name', 'firstname', 'first_name'],
  lastName: ['last name', 'family name', 'surname', 'lastname', 'last_name'],
  email: ['email', 'e-mail'],
  phone: ['phone', 'telephone', 'mobile'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile']
};

export function normal(value = '') { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function fieldKind(field) {
  if (!field || ignoredTypes.has(String(field.type || '').toLowerCase()) || field.tag === 'select' || field.tag === 'textarea') return null;
  const text = normal([field.label, field.name, field.id, field.placeholder, field.autocomplete].filter(Boolean).join(' '));
  return Object.entries(aliases).find(([, terms]) => terms.some(term => text.includes(normal(term))))?.[0] ?? null;
}
export function profileValues(profile) {
  const parts = String(profile?.name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' '), email: String(profile?.email || '').trim(), phone: String(profile?.phone || '').trim(), linkedin: String(profile?.linkedin || '').trim() };
}
export function planFields(fields, profile, approvedAnswers = new Map()) {
  const values = profileValues(profile); const seen = new Set(); const fills = [], questions = [];
  for (const field of fields) {
    if (!field.visible || field.disabled || field.value) continue;
    const questionLabel = field.questionLabel || field.label || field.name || 'Unlabeled required field';
    const approved = approvedAnswers.get(normal(questionLabel));
    if (approved) {
      const radioChoiceMatches = field.type !== 'radio' || normal(approved) === normal(field.label) || normal(approved) === normal(field.optionValue);
      if (radioChoiceMatches) { fills.push({ selector: field.selector, kind: 'approvedAnswer', value: approved, label: questionLabel, tag: field.tag, type: field.type }); continue; }
    }
    const kind = fieldKind(field);
    if (kind && values[kind] && !seen.has(kind)) { fills.push({ selector: field.selector, kind, value: values[kind], label: field.label || kind, tag: field.tag, type: field.type }); seen.add(kind); }
    else if (field.required && !kind) questions.push(questionLabel);
  }
  return { fills, questions: [...new Set(questions)] };
}
function allowed(platform, url) {
  try {
    const host = new URL(url).hostname;
    return platform === 'greenhouse' ? greenhouseHosts.test(host) : platform === 'workday' ? workdayHosts.test(host) : false;
  } catch { return false; }
}
async function scan(page) {
  return page.locator('input, textarea, select').evaluateAll(elements => elements.map((element, index) => {
    const id = element.id || ''; const linked = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
    const parentLabel = element.closest('label')?.textContent || '';
    const group = element.closest('fieldset,[role="radiogroup"]');
    const questionLabel = group?.querySelector('legend,[aria-label],[aria-labelledby]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const label = (linked || parentLabel || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const type = element.getAttribute('type') || ''; const name = element.getAttribute('name') || '';
    return { selector: id ? `#${CSS.escape(id)}` : `[name="${CSS.escape(name)}"]${type === 'radio' ? `[value="${CSS.escape(element.value)}"]` : ''}`, tag: element.tagName.toLowerCase(), type, name, id, placeholder: element.getAttribute('placeholder') || '', autocomplete: element.getAttribute('autocomplete') || '', label, questionLabel, optionValue: element.value || '', required: element.required || element.getAttribute('aria-required') === 'true', disabled: element.disabled, value: type === 'radio' ? (element.checked ? element.value : '') : element.value || '', visible: !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length), index };
  }));
}
function hasCaptcha(html) { return /captcha|recaptcha|hcaptcha/i.test(html); }
function applicationStep(fields) { return fields.some(field => field.required) || fields.filter(field => fieldKind(field)).length >= 2; }
async function saveSession(jobId, data) { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(path.join(DATA, `application-session-${jobId}.json`), JSON.stringify(data, null, 2)); }

export async function runApplicationWorker(store, job, { fillKnown = false, waitSeconds = 600, progress = () => {} } = {}) {
  if (!['greenhouse', 'workday'].includes(job.platform)) throw new Error('The supervised browser worker supports Greenhouse and public Workday career sites only.');
  if (!allowed(job.platform, job.url)) throw new Error(`The job URL is not an approved ${job.platform === 'greenhouse' ? 'Greenhouse' : 'Workday'} host.`);
  const profile = store.get('profile');
  if (!profile?.approved) throw new Error('Mark your profile accurate before using the browser worker.');
  const context = await chromium.launchPersistentContext(path.join(DATA, 'application-browser-profile'), { headless: false, viewport: { width: 1280, height: 900 } });
  const page = context.pages()[0] ?? await context.newPage();
  let completed = false;
  try {
    progress({ message: `Opening the ${job.platform === 'greenhouse' ? 'Greenhouse' : 'Workday'} posting in a visible browser. Sign in, click Apply, and advance steps yourself; this worker never submits.` });
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const deadline = Date.now() + Math.max(30, Math.min(Number(waitSeconds) || 600, 1800)) * 1000;
    while (Date.now() < deadline) {
      const url = page.url();
      if (!allowed(job.platform, url)) { progress({ message: 'Browser left the approved employer host. No fields were changed on the new page.' }); break; }
      const fields = await scan(page);
      if (!fields.length || !applicationStep(fields)) { await page.waitForTimeout(1000); continue; }
      const captcha = hasCaptcha(await page.content());
      const approvedAnswers = new Map(store.reusableAnswers().map(answer => [answer.question_key, answer.answer]));
      for (const question of store.applicationQuestions(job.id).filter(question => question.state === 'answered' && question.answer)) approvedAnswers.set(normal(question.prompt.replace(/^Portal question:\s*/i, '')), question.answer);
      const plan = planFields(fields, profile, approvedAnswers);
      const session = { jobId: job.id, url, scannedAt: new Date().toISOString(), captchaDetected: captcha, fillRequested: fillKnown, filled: [], unanswered: plan.questions, formFields: fields.map(({ selector, label, required, tag, type }) => ({ selector, label, required, tag, type })) };
      if (captcha) progress({ message: 'A CAPTCHA was detected. Complete it yourself; the worker will not interact with it.' });
      if (fillKnown && !captcha) {
        for (const fill of plan.fills) {
          const locator = page.locator(fill.selector).first();
          if (await locator.count() && await locator.isVisible()) {
            if (fill.type === 'radio') await locator.check();
            else if (fill.tag === 'select') await locator.selectOption({ label: fill.value });
            else await locator.fill(fill.value);
            session.filled.push({ kind: fill.kind, label: fill.label });
          }
        }
      }
      const existing = new Set(store.applicationQuestions(job.id).map(question => question.prompt));
      for (const prompt of plan.questions) {
        const question = `Portal question: ${prompt}`;
        if (!existing.has(question)) store.saveApplicationQuestion({ jobId: job.id, prompt: question, answer: '', state: 'needs_answer' });
      }
      if (plan.questions.length) store.saveApplicationDraft(job.id, 'paused', store.applicationDraft(job.id)?.notes ?? '');
      await saveSession(job.id, session);
      progress({ message: `${session.filled.length ? `Filled ${session.filled.length} reviewed factual fields. ` : ''}${plan.questions.length ? `${plan.questions.length} question(s) added to your inbox. ` : ''}Review the visible form; it will not be submitted.` });
      completed = true;
      // Keep the visible browser open: Workday commonly reveals another form after the user presses Next.
      // The next field fingerprint causes a fresh scan; this worker never presses Next or Submit.
    }
    if (!completed) progress({ message: 'No application form was detected before the worker timed out. No fields were changed.' });
    return { completed, fillRequested: fillKnown, sessionFile: path.join(DATA, `application-session-${job.id}.json`) };
  } finally { await context.close(); }
}
