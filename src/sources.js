import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publicError } from './errors.js';
import { REPOSITORY, SOURCE_URL } from './config.js';
import { parseJobList, greenhouseTarget, workdayTarget, plain, familyOf, levelOf, employerSalary, clean } from './domain.js';

const exec = promisify(execFile);
export async function importRepository(store, progress = () => {}, pull = false) {
  const gitArgs = ['-c', `safe.directory=${REPOSITORY.replaceAll('\\', '/')}`, '-C', REPOSITORY];
  if (pull) await exec('git', [...gitArgs, 'pull', '--ff-only'], { timeout: 60000, windowsHide: true });
  const { stdout } = await exec('git', [...gitArgs, 'rev-parse', 'HEAD'], { windowsHide: true });
  const commit = stdout.trim();
  let imported = 0;
  for (const file of ['NEW_GRAD_USA.md', 'README.md', 'NEW_GRAD_INTL.md', 'INTERN_INTL.md']) {
    const markdown = await fs.readFile(`${REPOSITORY}/${file}`, 'utf8');
    const jobs = parseJobList(markdown, { file, sourceUrl: SOURCE_URL, commit });
    for (const row of jobs) {
      const old = store.job(row.id);
      // A list refresh must not erase employer-verified descriptions or closure evidence.
      store.upsert(old ? { ...row, ...old, sourceUrl: row.sourceUrl, sourceCommit: commit, sourceFetchedAt: row.sourceFetchedAt, sourceAgeDays: row.sourceAgeDays } : row);
      imported++;
    }
    progress({ message: `Imported ${file}`, imported });
  }
  const summary = { repository: SOURCE_URL, commit, imported, uniqueJobs: store.allJobs().length, at: new Date().toISOString() };
  store.set('source', summary);
  return summary;
}
async function publicJson(url) {
  const u = new URL(url);
  if (!(u.hostname === 'boards-api.greenhouse.io' || u.hostname === 'boards-api.eu.greenhouse.io' || /^[a-z0-9-]+(?:\.wd\d+)?\.myworkdayjobs\.com$/i.test(u.hostname))) throw new Error('Unsupported detail host');
  const response = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json', 'User-Agent': 'LocalJobMatcher/0.1 (personal job discovery)' } });
  if (response.status === 404 || response.status === 410) return { closed: true };
  if (!response.ok) throw new Error(`Employer returned HTTP ${response.status}`);
  return { data: await response.json() };
}
export async function fetchDetails(job) {
  const at = new Date().toISOString();
  let description, details, title, location;
  if (job.platform === 'greenhouse') {
    const target = greenhouseTarget(job.url);
    if (!target) throw new Error('This Greenhouse wrapper needs browser inspection.');
    const response = await publicJson(`https://${target.apiHost}/v1/boards/${target.board}/jobs/${target.jobId}?questions=true`);
    if (response.closed) return { ...job, status: 'closed', detailsCheckedAt: at };
    const data = response.data;
    description = plain(plain(data.content));
    title = data.title;
    location = data.location?.name;
    details = { method: 'Greenhouse public Job Board API', jobId: data.id, internalJobId: data.internal_job_id, questions: data.questions ?? [], compliance: data.data_compliance ?? [], demographicQuestions: data.demographic_questions ?? null };
  } else if (job.platform === 'workday') {
    const target = workdayTarget(job.url);
    if (!target) throw new Error('This Workday career-site format needs browser inspection.');
    // Public website read endpoint; best effort, not a supported Workday integration API.
    const response = await publicJson(`https://${target.host}/wday/cxs/${target.tenant}/${target.site}/${target.jobPath}`);
    if (response.closed) throw new Error('Workday endpoint is unavailable; inspect the employer page to confirm whether the role is closed.');
    const data = response.data.jobPostingInfo;
    if (!data?.jobDescription) throw new Error('Workday did not return a readable job description.');
    description = plain(data.jobDescription);
    title = data.title;
    location = data.location;
    details = { method: 'Workday public career-site JSON (unofficial read adapter)', requisitionId: data.jobReqId, timeType: data.timeType, postedOn: data.postedOn, startDate: data.startDate };
  } else throw new Error('Live detail fetching currently supports Greenhouse and Workday.');
  if (!description) throw new Error('Employer returned no description.');
  const paragraphs = description.split('\n');
  const requirements = paragraphs.filter(p => /require|qualificat|\byears?\b|degree|bachelor|master|ph\.?d|enroll|graduat|sponsor|authoriz|citizen|eligible/i.test(p)).map(p => ({ text: p, source: 'employer description', interpretation: 'unreviewed' }));
  const pay = employerSalary(description);
  return { ...job, ...(pay ?? {}), title: title || job.title, location: clean(location) || job.location, description, details, requirements, family: familyOf(title || job.title), level: levelOf(title || job.title, job.kind, description), status: 'open', detailsCheckedAt: at, detailError: null, descriptionTruncated: false };
}
export async function enrichJobs(store, jobs, progress = () => {}, force = false) {
  let checked = 0, open = 0, closed = 0, failed = 0;
  const errors = [];
  for (let i = 0; i < jobs.length; i += 2) {
    const batch = jobs.slice(i, i + 2);
    const results = await Promise.allSettled(batch.map(async job => {
      if (!force && job.detailsCheckedAt && Date.now() - Date.parse(job.detailsCheckedAt) < 24 * 3600000) return job;
      return fetchDetails(job);
    }));
    results.forEach((result, n) => {
      checked++;
      if (result.status === 'fulfilled') { store.upsert(result.value); if (result.value.status === 'open') open++; if (result.value.status === 'closed') closed++; }
      else { failed++; const job = batch[n]; const error = publicError(result.reason, 'employer:check', 'The employer page could not be checked. You can open it directly.').error; errors.push({ id: job.id, company: job.company, error }); store.upsert({ ...job, detailError: error, lastFetchAttempt: new Date().toISOString() }); }
    });
    progress({ message: `Checked ${checked}/${jobs.length} employer pages`, checked, total: jobs.length, open, closed, failed });
  }
  return { checked, open, closed, failed, errors };
}
