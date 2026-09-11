import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, DATA, EMBED_MODEL, REVIEW_MODEL } from './config.js';
import { openStore } from './db.js';
import { hash, matchesFilters, marketSalaryEstimate } from './domain.js';
import { importRepository, enrichJobs } from './sources.js';
import { saveProfile, importResume } from './profile.js';
import { searchJobs, indexJobs, reviewJob, modelStatus, REVIEW_VERSION } from './models.js';
import { GreenhouseBrowser } from './greenhouse-browser.js';
import { WorkdayBrowser } from './workday-browser.js';
import { portalAccountStatus, savePortalAccount } from './portal-account.js';
import { validateEmploymentHistory } from './answer-defaults.js';
import { GmailBrowser } from './gmail-browser.js';
import { UserFacingError, publicError, publicData } from './errors.js';

const store = openStore();
let applicationBrowser = new GreenhouseBrowser(store);
const interruptedBrowser = store.get('greenhouseSession');
if (interruptedBrowser && !['submitted', 'stopped'].includes(interruptedBrowser.state)) {
  const uncertain = ['submitting', 'submission_unknown', 'email_verification'].includes(interruptedBrowser.state);
  store.set('greenhouseSession', { ...interruptedBrowser, state: uncertain ? 'submission_unknown' : 'stopped', message: 'Server restarted. Check the application before restarting.' });
  store.saveApplicationDraft(interruptedBrowser.jobId, uncertain ? 'submission_unknown' : 'paused', store.applicationDraft(interruptedBrowser.jobId)?.notes || '');
}
const token = randomBytes(32).toString('hex');
const port = Number(process.env.JOB_BOT_PORT ?? 4317);
const gmail = new GmailBrowser();
// Automatic mailbox integration is WIP. Manual verification remains supported.
let task = null;
let lastRanking = null;
let modelCache = { at: 0, value: null };
const applicationFiles = {
  context: { name: 'application-context.md', initial: '# Application context\n\nAdd stable facts you want available while preparing applications: work authorization, location preferences, portfolio links, factual experience details, and anything an employer might ask repeatedly. Keep this factual and review it before use.\n' },
  instructions: { name: 'application-instructions.md', initial: '# Application instructions\n\nAdd your writing preferences and boundaries here. For example: use only facts in my resume and context; never claim experience I do not have; leave uncertain questions for me; do not submit applications.\n' }
};
const oldTask = store.get('task');
if (oldTask?.state === 'running') store.set('task', { ...oldTask, state: 'interrupted', message: 'The app restarted. Run the operation again to continue.' });

function summaryJob(job, population = store.allJobs()) {
  const { description, requirements, details, ...rest } = job;
  const queue = store.db.prepare('SELECT state FROM queue WHERE job_id=?').get(job.id);
  const profileHash = store.get('profile')?.hash;
  const reviews = store.db.prepare('SELECT data FROM reviews WHERE job_id=? ORDER BY rowid DESC LIMIT 10').all(job.id).map(r => JSON.parse(r.data));
  const review = reviews.find(r => r.version === REVIEW_VERSION && r.profileHash === profileHash && r.jobHash === job.contentHash);
  return { ...rest, salaryEstimate: marketSalaryEstimate(job, population), descriptionLength: description?.length ?? 0, queueState: queue?.state ?? null, reviewRecommendation: review?.recommendation ?? null };
}
function beginTask(name, work) {
  if (task?.state === 'running') throw Object.assign(new UserFacingError('Another operation is running. Let it finish first.'), { status: 409 });
  task = { id: randomBytes(8).toString('hex'), name, state: 'running', message: name, startedAt: new Date().toISOString() };
  store.set('task', task);
  const progress = update => { task = { ...task, ...update }; store.set('task', task); };
  Promise.resolve().then(() => work(progress)).then(result => {
    task = { ...task, state: 'done', message: `${name} complete`, result, finishedAt: new Date().toISOString() };
    store.set('task', task); store.event('task_completed', { name, id: task.id }); lastRanking = null;
  }).catch(error => { const report = publicError(error, `task:${name}`); task = { ...task, state: 'failed', message: report.error, reference: report.reference, finishedAt: new Date().toISOString() }; store.set('task', task); });
  return task;
}
async function bodyJson(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw Object.assign(new UserFacingError('JSON content type required.'), { status: 415 });
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 15 * 1024 * 1024) throw Object.assign(new UserFacingError('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new UserFacingError('Invalid JSON.'), { status: 400 }); }
}
function send(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(status >= 400 ? data : publicData(data))); }
function activeJobs(body) {
  const ids = Array.isArray(body.ids) ? new Set(body.ids) : null;
  return store.allJobs().filter(j => (!ids || ids.has(j.id)) && matchesFilters(j, { supportedOnly: true, ...(body.filters ?? {}) })).sort((a, b) => (a.sourceAgeDays ?? 9999) - (b.sourceAgeDays ?? 9999));
}
async function applicationText(kind) {
  const item = applicationFiles[kind];
  if (!item) throw Object.assign(new UserFacingError('Unknown application document.'), { status: 404 });
  const file = path.join(DATA, item.name);
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(file, item.initial, { flag: 'wx' }); return item.initial; }
}
function cleanApplicationText(value, label) {
  if (typeof value !== 'string' || value.length > 40000) throw new UserFacingError(`${label} must be plain text under 40,000 characters.`);
  return value.replace(/\r\n/g, '\n');
}
function applicationConsentStatus() {
  const consent = store.get('applicationConsent', {});
  return { applicationTerms: consent.applicationTerms === true, routinePolicies: consent.routinePolicies === true, updatedAt: consent.applicationTermsApproval?.updatedAt ?? null };
}
async function selectedResume(input) {
  if (!input) return undefined;
  if (!/\.(pdf|docx|txt)$/i.test(input.name || '') || typeof input.base64 !== 'string') throw new UserFacingError('Choose a PDF, DOCX, or TXT resume.');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new UserFacingError('Resume must be between 1 byte and 10 MB.');
  const file = path.join(DATA, `application-upload-${hash(bytes).slice(0, 24)}${path.extname(input.name).toLowerCase()}`);
  await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(file, bytes);
  return { path: file, name: path.basename(input.name) };
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return send(res, { error: 'Invalid host.' }, 403);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, { error: 'Cross-origin requests are not allowed.' }, 403);
      if (req.headers['x-app-token'] !== token) return send(res, { error: 'Reload the app to start a local session.' }, 401);
      if (req.method === 'GET' && url.pathname === '/api/gmail') return send(res, { connected: false, wip: true });
      if (req.method === 'POST' && url.pathname === '/api/gmail') {
        const body = await bodyJson(req);
        if (body.action === 'connect') {
          throw new UserFacingError('Automatic email verification is work in progress. Open your email normally and enter the code in the application.');
        }
        if (body.action === 'disconnect') return send(res, await gmail.disconnect());
        throw new UserFacingError('Unknown Gmail action.');
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (Date.now() - modelCache.at > 15000) modelCache = { at: Date.now(), value: await modelStatus() };
        const jobs = store.allJobs();
        return send(res, { total: jobs.length, supported: jobs.filter(j => ['greenhouse', 'workday'].includes(j.platform)).length, verified: jobs.filter(j => j.status === 'open').length, closed: jobs.filter(j => j.status === 'closed').length, vectorJobs: store.db.prepare('SELECT count(DISTINCT job_id) AS count FROM vectors').get().count, queue: store.db.prepare('SELECT count(*) AS count FROM queue').get().count, applicationQuestions: store.db.prepare("SELECT count(*) AS count FROM application_questions WHERE state='needs_answer'").get().count, source: store.get('source'), profile: store.get('profile') ? { sourceName: store.get('profile').sourceName, approved: store.get('profile').approved, skills: store.get('profile').skills } : null, models: modelCache.value, task: task ?? store.get('task'), capabilities: { semanticSearch: true, localReview: true, applicationPrep: true, automaticSubmission: false } });
      }
      if (req.method === 'GET' && url.pathname === '/api/profile') return send(res, store.get('profile', { text: '', name: '', email: '', phone: '', approved: false }));
      if (req.method === 'GET' && url.pathname === '/api/portal-account') return send(res, portalAccountStatus(store));
      if (req.method === 'POST' && url.pathname === '/api/portal-account') return send(res, await savePortalAccount(store, await bodyJson(req)));
      if (req.method === 'GET' && url.pathname === '/api/application-consent') return send(res, applicationConsentStatus());
      if (req.method === 'POST' && url.pathname === '/api/application-consent') {
        const body = await bodyJson(req);
        if (typeof body?.applicationTerms !== 'boolean') throw Object.assign(new UserFacingError('Choose whether to accept ordinary application terms.'), { status: 400 });
        const updatedAt = new Date().toISOString();
        const approval = { enabled: body.applicationTerms, updatedAt, source: 'profile' };
        store.set('applicationConsent', { ...store.get('applicationConsent', {}), applicationTerms: body.applicationTerms, applicationTermsApproval: approval, updatedAt });
        store.event('application_terms_consent_updated', approval);
        return send(res, applicationConsentStatus());
      }
      if (req.method === 'GET' && url.pathname === '/api/employment-history') return send(res, store.get('employmentHistory', { entries: [], reviewed: false, complete: false }));
      if (req.method === 'POST' && url.pathname === '/api/employment-history') {
        const history = validateEmploymentHistory(await bodyJson(req)); store.set('employmentHistory', history);
        store.event('employment_history_updated', { updatedAt: history.updatedAt, count: history.entries.length, complete: history.complete });
        return send(res, history);
      }
      if (req.method === 'POST' && url.pathname === '/api/client-error') {
        const body = await bodyJson(req);
        publicError(new Error(String(body.message || 'Browser error').slice(0, 4000)), 'frontend');
        return send(res, { logged: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/application-browser') return send(res, applicationBrowser.state());
      if (req.method === 'GET' && url.pathname === '/api/application-browser/preview') return send(res, await applicationBrowser.preview());
      if (req.method === 'POST' && url.pathname === '/api/application-browser') {
        const body = await bodyJson(req);
        if (body.action === 'pause') return send(res, applicationBrowser.pause());
        if (body.action === 'inspect') return send(res, await applicationBrowser.inspect(body.fieldId));
        if (['resume', 'inspect'].includes(body.action) && process.env.JOB_BOT_DEV_RELOAD === '1' && applicationBrowser instanceof WorkdayBrowser && !applicationBrowser.busy && !applicationBrowser.session?.submissionAttempted) {
          const stamp = (await fs.stat(new URL('./workday-browser.js', import.meta.url))).mtimeMs;
          const { WorkdayBrowser: Updated } = await import(`./workday-browser.js?version=${stamp}`);
          for (const name of Object.getOwnPropertyNames(Updated.prototype)) if (name !== 'constructor') applicationBrowser[name] = Updated.prototype[name];
        }
        if (body.action === 'resume') return send(res, await applicationBrowser.resume(await selectedResume(body.resume)));
        if (body.action === 'submit') return send(res, await applicationBrowser.submit(body.revision));
        if (body.action === 'verify-email') return send(res, await applicationBrowser.verifyEmail(body.code));
        if (body.action === 'check-gmail') {
          throw new UserFacingError('Automatic email verification is work in progress. Enter the code manually.');
        }
        if (body.action === 'close') return send(res, await applicationBrowser.close());
        if (body.action !== 'start') throw new UserFacingError('Unknown browser action.');
        let resume;
        if (body.resume) {
          if (!/\.(pdf|docx|txt)$/i.test(body.resume.name || '') || typeof body.resume.base64 !== 'string') throw new UserFacingError('Choose a PDF, DOCX, or TXT resume.');
          const bytes = Buffer.from(body.resume.base64, 'base64');
          if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new UserFacingError('Resume must be between 1 byte and 10 MB.');
          const file = path.join(DATA, `application-upload-${hash(bytes).slice(0, 24)}${path.extname(body.resume.name).toLowerCase()}`);
          await fs.writeFile(file, bytes);
          resume = { path: file, name: path.basename(body.resume.name) };
        }
        const job = store.job(body.jobId);
        if (!applicationBrowser.session && !applicationBrowser.busy) applicationBrowser = job?.platform === 'workday' ? new WorkdayBrowser(store) : new GreenhouseBrowser(store);
        return send(res, await applicationBrowser.start(job, { mode: body.mode, email: body.email, firstName: body.firstName, lastName: body.lastName, resume, autoSubmit: body.autoSubmit }));
      }
      if (req.method === 'GET' && url.pathname === '/api/application-documents') return send(res, { context: await applicationText('context'), instructions: await applicationText('instructions') });
      if (req.method === 'POST' && url.pathname === '/api/application-documents') {
        const body = await bodyJson(req); const kind = body.kind;
        const item = applicationFiles[kind]; if (!item) throw new UserFacingError('Unknown application document.');
        const text = cleanApplicationText(body.text, item.name); await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(path.join(DATA, item.name), text, 'utf8');
        return send(res, { kind, text });
      }
      if (req.method === 'GET' && url.pathname === '/api/applications') {
        const jobs = new Map(store.allJobs().map(job => [job.id, job]));
        const drafts = store.applicationDrafts().map(draft => ({ ...draft, job: jobs.get(draft.job_id) ? summaryJob(jobs.get(draft.job_id)) : null }));
        return send(res, { drafts, questions: store.applicationQuestions().filter(q => q.state !== 'resolved').map(question => ({ ...question, job: jobs.get(question.job_id) ? { id: question.job_id, title: jobs.get(question.job_id).title, company: jobs.get(question.job_id).company } : null })), reusableAnswers: store.reusableAnswers() });
      }
      if (req.method === 'POST' && url.pathname === '/api/applications/export') {
        const jobs = new Map(store.allJobs().map(job => [job.id, job]));
        const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
        const rows = store.applicationDrafts().map(draft => {
          const job = jobs.get(draft.job_id);
          return [job?.company ?? '', job?.title ?? '', job?.url ?? '', draft.state, draft.notes, draft.updated_at].map(quote).join(',');
        });
        return send(res, { csv: ['Company,Role,Employer URL,Status,Notes,Last updated', ...rows].join('\r\n') });
      }
      if (req.method === 'POST' && url.pathname === '/api/applications') {
        const body = await bodyJson(req); if (!store.job(body.jobId)) throw new UserFacingError('Unknown job.');
        const states = new Set(['planning', 'in_progress', 'ready_for_review', 'paused', 'submitted', 'submission_unknown', 'done']); const state = states.has(body.state) ? body.state : 'planning';
        const notes = cleanApplicationText(body.notes ?? '', 'Preparation notes'); if (notes.length > 12000) throw new UserFacingError('Preparation notes must be under 12,000 characters.');
        return send(res, store.saveApplicationDraft(body.jobId, state, notes));
      }
      if (req.method === 'POST' && url.pathname === '/api/application-questions') {
        const body = await bodyJson(req); if (!store.job(body.jobId)) throw new UserFacingError('Unknown job.');
        const prompt = cleanApplicationText(body.prompt, 'Question').trim(); const answer = cleanApplicationText(body.answer ?? '', 'Answer').trim();
        if (!prompt || prompt.length > 4000) throw new UserFacingError('Question must contain 1–4,000 characters.');
        const states = new Set(['needs_answer', 'answered']); const state = states.has(body.state) ? body.state : answer ? 'answered' : 'needs_answer';
        return send(res, store.saveApplicationQuestion({ id: body.id ? Number(body.id) : null, jobId: body.jobId, prompt, answer, state }));
      }
      if (req.method === 'POST' && url.pathname === '/api/reusable-answers') {
        const body = await bodyJson(req); const prompt = cleanApplicationText(body.prompt, 'Question').trim(); const answer = cleanApplicationText(body.answer, 'Answer').trim();
        if (!prompt || !answer || prompt.length > 4000 || answer.length > 12000) throw new UserFacingError('A reusable question and answer are required.');
        const questionKey = cleanApplicationText(body.questionKey, 'Question key').trim().toLowerCase();
        if (!questionKey || questionKey.length > 4000) throw new UserFacingError('Invalid reusable question.');
        return send(res, store.saveReusableAnswer(questionKey, prompt, answer));
      }
      if (req.method === 'POST' && url.pathname === '/api/profile') { const profile = saveProfile(store, await bodyJson(req)); lastRanking = null; return send(res, profile); }
      if (req.method === 'POST' && url.pathname === '/api/profile/upload') {
        const body = await bodyJson(req);
        if (!/\.(pdf|txt)$/i.test(body.name ?? '') || typeof body.base64 !== 'string') throw new UserFacingError('Choose a PDF or TXT resume.');
        const bytes = Buffer.from(body.base64, 'base64');
        if (bytes.length > 10 * 1024 * 1024) throw new UserFacingError('Resume must be under 10 MB.');
        const file = path.join(DATA, `uploaded-${hash(bytes).slice(0, 16)}${path.extname(body.name).toLowerCase()}`);
        await fs.writeFile(file, bytes);
        const result = await importResume(store, file);
        const profile = store.get('profile'); profile.sourceName = path.basename(body.name); store.set('profile', profile); lastRanking = null;
        return send(res, { ...result, sourceName: profile.sourceName });
      }
      if (req.method === 'GET' && url.pathname === '/api/filters') return send(res, store.get('filters', { kind: 'new-grad', scope: 'US', supportedOnly: true, query: 'quantitative research, machine learning, data science' }));
      if (req.method === 'POST' && url.pathname === '/api/filters') { const body = await bodyJson(req); store.set('filters', body); return send(res, body); }
      if (req.method === 'POST' && url.pathname === '/api/search') {
        const body = await bodyJson(req);
        lastRanking = await searchJobs(store, String(body.query ?? '').slice(0, 2000), body.filters ?? {}, true);
        const population = store.allJobs();
        const result = { ...lastRanking, jobs: lastRanking.jobs.map(job => summaryJob(job, population)) };
        store.set('lastQuery', { query: result.query, filters: result.filters });
        return send(res, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') {
        const jobs = store.allJobs().sort((a, b) => (a.sourceAgeDays ?? 9999) - (b.sourceAgeDays ?? 9999));
        return send(res, { jobs: jobs.map(job => summaryJob(job, jobs)), total: jobs.length });
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]{24})$/);
      if (req.method === 'GET' && jobMatch) {
        const job = store.job(jobMatch[1]); if (!job) return send(res, { error: 'Job not found.' }, 404);
        const profileHash = store.get('profile')?.hash;
        const reviews = store.db.prepare('SELECT data FROM reviews WHERE job_id=? ORDER BY rowid DESC LIMIT 10').all(job.id).map(r => JSON.parse(r.data));
        return send(res, { ...job, ...summaryJob(job, store.allJobs()), review: reviews.find(r => r.version === REVIEW_VERSION && r.profileHash === profileHash && r.jobHash === job.contentHash) ?? null });
      }
      if (req.method === 'POST' && url.pathname === '/api/queue') {
        const body = await bodyJson(req); if (!store.job(body.id)) throw new UserFacingError('Unknown job.');
        if (body.remove) store.db.prepare('DELETE FROM queue WHERE job_id=?').run(body.id);
        else store.db.prepare('INSERT INTO queue VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at').run(body.id, 'shortlisted', new Date().toISOString());
        return send(res, { saved: !body.remove });
      }
      if (req.method === 'POST' && url.pathname === '/api/tasks') {
        const body = await bodyJson(req);
        if (body.action === 'refresh') return send(res, beginTask('Refresh listings', progress => importRepository(store, progress, true)), 202);
        if (body.action === 'enrich') return send(res, beginTask('Check employer pages', progress => enrichJobs(store, activeJobs(body).slice(0, Math.min(200, Number(body.limit ?? 80))), progress, true)), 202);
        if (body.action === 'index') return send(res, beginTask('Prepare semantic search', progress => indexJobs(store, activeJobs(body), progress)), 202);
        if (body.action === 'review') {
          const job = store.job(body.id); if (!job) throw new UserFacingError('Unknown job.');
          return send(res, beginTask('Analyze job fit', progress => reviewJob(store, job, progress)), 202);
        }
        throw new UserFacingError('Unknown action.');
      }
      return send(res, { error: 'Route not found.' }, 404);
    }
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (req.method !== 'GET' || !assets[url.pathname]) return send(res, { error: 'Not found.' }, 404);
    const [file, type] = assets[url.pathname];
    let data = await fs.readFile(path.join(ROOT, 'web', file), 'utf8');
    if (file === 'index.html') data = data.replace('__APP_TOKEN__', token);
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(data);
  } catch (error) { send(res, publicError(error, `${req.method} ${new URL(req.url, 'http://localhost').pathname}`), error.status ?? 400); }
});
server.listen(port, '127.0.0.1', () => console.log(`Job Desk is running at http://127.0.0.1:${port}`));
server.on('error', error => { publicError(error, 'server'); process.exitCode = 1; store.close(); });
