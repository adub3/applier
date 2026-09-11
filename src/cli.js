import fs from 'node:fs/promises';
import path from 'node:path';
import { openStore } from './db.js';
import { DATA } from './config.js';
import { importRepository, enrichJobs } from './sources.js';
import { importResume } from './profile.js';
import { indexJobs, searchJobs, reviewJob, modelStatus } from './models.js';
import { matchesFilters } from './domain.js';

const store = openStore();
const [command, ...args] = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback; };
const log = data => console.log(JSON.stringify(data));
try {
  if (command === 'ingest') log(await importRepository(store, log, args.includes('--pull')));
  else if (command === 'profile') log(await importResume(store, args[0]));
  else if (command === 'status') {
    const jobs = store.allJobs();
    log({ jobs: jobs.length, platforms: Object.fromEntries(['greenhouse', 'workday', 'other'].map(p => [p, jobs.filter(j => j.platform === p).length])), open: jobs.filter(j => j.status === 'open').length, profile: store.get('profile')?.sourceName ?? null, models: await modelStatus() });
  } else if (command === 'enrich') {
    const jobs = store.allJobs().filter(j => matchesFilters(j, { supportedOnly: true, kind: value('--kind', 'all'), scope: value('--scope', 'US') })).sort((a, b) => (a.sourceAgeDays ?? 9999) - (b.sourceAgeDays ?? 9999)).slice(0, Number(value('--limit', '80')));
    log(await enrichJobs(store, jobs, log, args.includes('--force')));
  } else if (command === 'index') {
    const jobs = store.allJobs().filter(j => matchesFilters(j, { supportedOnly: true, scope: value('--scope', 'US') }));
    log(await indexJobs(store, jobs, log));
  } else if (command === 'search') {
    const result = await searchJobs(store, value('--query', 'quantitative research machine learning data science software engineering'), { supportedOnly: true, kind: value('--kind', 'new-grad'), scope: value('--scope', 'US'), excludePhdTitle: args.includes('--exclude-phd'), verifiedOnly: args.includes('--verified') });
    const summary = result.jobs.slice(0, Number(value('--limit', '20'))).map((j, i) => ({ rank: i + 1, id: j.id, title: j.title, company: j.company, platform: j.platform, location: j.location, status: j.status, sharedSkills: j.sharedSkills, semanticSimilarity: j.semanticSimilarity, url: j.url }));
    store.set('lastSearch', { ...result, jobs: result.jobs.map(j => j.id) });
    await fs.writeFile(path.join(DATA, 'shortlist.json'), JSON.stringify({ ...result, jobs: summary }, null, 2));
    log({ total: result.total, semanticIndexed: result.semanticIndexed, semanticError: result.semanticError, jobs: summary });
  } else if (command === 'review') {
    const ids = args.filter(a => !a.startsWith('--'));
    for (const id of ids) {
      const job = store.job(id);
      if (!job) throw new Error(`Unknown job ${id}`);
      const review = await reviewJob(store, job, log);
      await fs.writeFile(path.join(DATA, `review-${id}.json`), JSON.stringify(review, null, 2));
      log({ id, title: job.title, ...review });
    }
  } else if (command === 'apply') {
    throw new Error('Use Application prep → Greenhouse automation in the dashboard. Select the email, resume, and automation level there; the old scan-only CLI has been retired.');
  } else throw new Error('Commands: ingest [--pull], profile <resume.pdf>, enrich [--limit 80], index, search [--query text], review <job-id>, apply <job-id> [--fill-known] [--wait 600], status');
} catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
finally { store.close(); }
