import test from 'node:test';
import assert from 'node:assert/strict';
import { atsOf, publicUrl, greenhouseTarget, workdayTarget, canonicalJob, parseJobList, parseSalary, employerSalary, marketSalaryEstimate, matchesFilters, chunksFor, cosine, fuseRanks, skillsIn, levelOf, hash } from '../src/domain.js';
import { openStore } from '../src/db.js';
import { validateReview, searchJobs, evidencePassages, searchFamily } from '../src/models.js';
import { fetchDetails, enrichJobs } from '../src/sources.js';
import { saveProfile } from '../src/profile.js';
import { fieldKind, planFields, profileValues } from '../src/application-worker.js';

const context = { file: 'NEW_GRAD_USA.md', sourceUrl: 'https://github.com/example/jobs', commit: 'abc123', fetchedAt: '2026-09-09T00:00:00Z' };
const row = '| Example | Quant Researcher | New York | $120k/yr | <a href="https://job-boards.greenhouse.io/example/jobs/123">Apply</a> | 2d |';
const fixture = () => parseJobList(row, context)[0];

test('parses both salary and salary-free repository tables', () => {
  const data = parseJobList(row + '\n| ↳ | ML Engineer | Boston | <a href="https://example.wd1.myworkdayjobs.com/en-US/Careers/job/Boston/ML_R321">Apply</a> | 1d |', context);
  assert.equal(data.length, 2); assert.equal(data[0].salaryMax, 120000); assert.equal(data[1].company, 'Example');
  assert.equal(data[1].platform, 'workday'); assert.equal(data[1].salaryMax, null); assert.equal(data[1].sourceAgeDays, 1);
  assert.equal(data[0].sourceUrl, 'https://github.com/example/jobs/blob/abc123/NEW_GRAD_USA.md');
});
test('rejects untrusted protocols, credentials and private address literals', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://127.0.0.1', 'https://172.16.1.1', 'https://[::1]', 'https://test.local', 'https://example.com:8080']) assert.throws(() => publicUrl(url));
  assert.equal(atsOf('https://job-boards.greenhouse.io.evil.com/jobs/12'), 'other');
  assert.equal(greenhouseTarget('https://evilgreenhouse.io/example/jobs/123'), null);
});
test('canonicalization deduplicates Greenhouse tracking links, preserves EU boundary', () => {
  assert.equal(canonicalJob('https://boards.greenhouse.io/example/jobs/123?gh_src=one'), canonicalJob('https://job-boards.greenhouse.io/example/jobs/123?utm_source=two'));
  assert.notEqual(canonicalJob('https://boards.eu.greenhouse.io/example/jobs/123'), canonicalJob('https://boards.greenhouse.io/example/jobs/123'));
  assert.equal(greenhouseTarget('https://boards.greenhouse.io/embed/job_app?for=example&gh_jid=123').board, 'example');
});
test('Workday adapter accounts for locale and requisition alias', () => {
  const a = 'https://example.wd5.myworkdayjobs.com/en-US/External/job/New-York/Quant_JR123';
  const b = 'https://example.wd5.myworkdayjobs.com/University/job/Boston/Research_JR123?source=other';
  assert.equal(canonicalJob(a), canonicalJob(b));
  assert.deepEqual(workdayTarget(a), { host: 'example.wd5.myworkdayjobs.com', tenant: 'example', site: 'External', jobPath: 'job/New-York/Quant_JR123' });
  assert.equal(workdayTarget('https://example.myworkdaysite.com/recruiting/jobs/123'), null);
});
test('salary filters do not treat unknown or hourly pay as an annual figure', () => {
  assert.equal(parseSalary('$50/hr').salaryPeriod, 'hour');
  assert.equal(parseSalary('Not listed').salaryMax, null);
  assert.equal(matchesFilters(fixture(), { minSalary: 100000 }), true);
  assert.equal(matchesFilters({ ...fixture(), ...parseSalary('$500/hr') }, { minSalary: 100000 }), false);
  assert.equal(matchesFilters({ ...fixture(), ...parseSalary('') }, { minSalary: 1 }), false);
});
test('extracts labeled compensation from an employer description without inventing its period', () => {
  assert.deepEqual(employerSalary('Salary / Rate Minimum: $125,000\nSalary / Rate Maximum: $175,000'), { salaryText: 'Employer posting: $125,000–$175,000', salaryMin: 125000, salaryMax: 175000, salaryPeriod: 'unknown', salaryCurrency: 'USD', salarySource: 'employer posting' });
  assert.equal(employerSalary('Salary / Rate Minimum: $125,000\nSalary / Rate Maximum: $125,000 annually').salaryPeriod, 'year');
  assert.deepEqual(employerSalary('The base range for this role is $120,000 - $140,000 USD.'), { salaryText: 'Employer posting: $120,000–$140,000', salaryMin: 120000, salaryMax: 140000, salaryPeriod: 'unknown', salaryCurrency: 'USD', salarySource: 'employer posting' });
});
test('employer pay supports compact ranges, USD and single hourly rates', () => {
  const range = employerSalary('Base salary: $120k–150k per year.');
  assert.equal(range.salaryMin, 120000);
  assert.equal(range.salaryMax, 150000);
  assert.equal(range.salaryPeriod, 'year');
  assert.equal(employerSalary('Annual salary: USD 120,000 — 145,000').salaryMax, 145000);
  assert.equal(employerSalary('Pay: $42.50/hr').salaryMin, 42.5);
  assert.equal(employerSalary('Pay: $42.50/hr').salaryPeriod, 'hour');
  assert.equal(employerSalary('Salary: $120,000–140,000\nBenefits include hourly childcare.' ).salaryPeriod, 'unknown');
  assert.equal(employerSalary('Salary: CAD $120,000–$140,000 per year'), null);
  assert.equal(employerSalary('Learning budget: $2,000. We offer competitive pay.'), null);
  assert.equal(employerSalary('Job Description'), null);
});

test('saved descriptions supply pay even when a refresh fails', async () => {
  const store = openStore(':memory:'); const original = globalThis.fetch;
  try {
    const job = store.upsert({ ...fixture(), description: 'Base salary: $130k–160k annually.', detailError: 'fetch failed' });
    assert.equal(store.job(job.id).salaryMax, 160000);
    assert.equal(store.allJobs()[0].salarySource, 'employer posting');
    globalThis.fetch = async () => { throw new Error('fetch failed'); };
    await enrichJobs(store, [store.job(job.id)], () => {}, true);
    assert.equal(store.job(job.id).salaryMin, 130000);
    assert.equal(store.job(job.id).detailError, 'The website could not be reached. Check your internet connection and try again.');
  } finally { globalThis.fetch = original; store.close(); }
});

test('market estimate uses comparable local annual listings', () => {
  const missing = { ...fixture(), id: 'missing', salaryMin: null, salaryMax: null, salaryPeriod: 'unknown', salaryCurrency: 'unknown' };
  const peers = [100, 110, 120, 130, 140].map((amount, index) => ({ ...fixture(), id: `peer-${index}`, salaryMin: amount * 1000, salaryMax: (amount + 10) * 1000, salaryPeriod: 'year', salaryCurrency: 'USD' }));
  const estimate = marketSalaryEstimate(missing, peers);
  assert.deepEqual(estimate && { min: estimate.min, max: estimate.max, sampleSize: estimate.sampleSize, source: estimate.source }, { min: 110000, max: 140000, sampleSize: 5, source: 'local comparable listings' });
  assert.equal(estimate.examples.length, 5); assert.equal(estimate.examples[0].url, fixture().url);
  assert.equal(marketSalaryEstimate(missing, peers.map(peer => ({ ...peer, company: 'Another employer' }))), null);
  assert.equal(marketSalaryEstimate({ ...missing, kind: 'internship' }, peers), null);
  assert.equal(marketSalaryEstimate(missing, peers.slice(0, 1)), null);
});
test('career level favors explicit title or employer requirements over a vague title', () => {
  assert.equal(levelOf('Senior Data Scientist', 'new-grad', '0 years of experience'), 'Experienced');
  assert.equal(levelOf('Data Scientist', '', '3+ years of professional experience required.'), 'Experienced');
  assert.equal(levelOf('Researcher', '', 'Recent graduates are encouraged to apply.'), 'Early career');
  assert.equal(levelOf('Software Engineer'), 'Unknown');
});
test('hard filters apply before ranking; degree exclusion concerns titles only', () => {
  const job = { ...fixture(), description: 'PhD preferred but not required.' };
  assert.equal(matchesFilters(job, { excludePhdTitle: true }), true);
  assert.equal(matchesFilters({ ...job, title: 'PhD ML Researcher' }, { excludePhdTitle: true }), false);
  assert.equal(matchesFilters(job, { verifiedOnly: true }), false);
  assert.equal(matchesFilters({ ...job, status: 'closed' }), false);
  assert.equal(matchesFilters(job, { platform: 'workday' }), false);
  assert.equal(matchesFilters(job, { location: 'new york', kind: 'new-grad' }), true);
});
test('technical skill boundaries do not hallucinate R or Java', () => {
  const skills = skillsIn('Researcher building JavaScript models in C++ and Python');
  assert.ok(skills.includes('C++')); assert.ok(skills.includes('JavaScript'));
  assert.ok(!skills.includes('Java')); assert.ok(!skills.includes('R'));
});
test('chunking retains late requirements and bounded paragraph fragments', () => {
  const chunks = chunksFor({ ...fixture(), description: 'a'.repeat(7000) + '\nFinal requirement: Python.' });
  assert.ok(chunks.length > 2); assert.ok(chunks.at(-1).includes('Final requirement: Python.'));
  assert.ok(chunks.every(c => c.length < 2600)); assert.equal(chunksFor(fixture()).length, 1);
});
test('cosine and reciprocal rank fusion have deterministic edge handling', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1); assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 2]), null); assert.equal(cosine([1], [1, 2]), null);
  const scores = fuseRanks([['a', 'b'], ['b', 'c']]); assert.ok(scores.get('b') > scores.get('a'));
});
test('binary hashes distinguish invalid UTF-8 byte sequences', () => { assert.notEqual(hash(Buffer.from([255])), hash(Buffer.from([254]))); });
test('upserts deduplicate FTS and invalidate stale vectors', () => {
  const store = openStore(':memory:');
  try {
    let job = store.upsert(fixture()); store.upsert(job);
    assert.equal(store.allJobs().length, 1); assert.equal(store.lexical('quant').length, 1);
    store.vectors(job, 'model@digest', [[1, 2, 3]]); assert.equal(store.vectorRows('model@digest').length, 1);
    store.upsert(job); assert.equal(store.vectorRows('model@digest').length, 1);
    job = store.upsert({ ...job, description: 'Python required' }); assert.equal(store.vectorRows('model@digest').length, 0);
    assert.equal(store.lexical('Python')[0].id, job.id);
  } finally { store.close(); }
});
test('application prep persists reviewed drafts and keeps unanswered questions open', () => {
  const store = openStore(':memory:');
  try {
    const job = store.upsert(fixture());
    const draft = store.saveApplicationDraft(job.id, 'planning', 'Check work authorization wording.');
    assert.equal(draft.state, 'planning'); assert.equal(store.applicationDrafts().length, 1);
    assert.equal(store.saveApplicationDraft(job.id, 'submitted', 'Submission confirmed by me.').state, 'submitted');
    const open = store.saveApplicationQuestion({ jobId: job.id, prompt: 'Are you authorized to work?', answer: '', state: 'needs_answer' });
    assert.equal(store.applicationQuestions()[0].state, 'needs_answer');
    const answered = store.saveApplicationQuestion({ id: open.id, jobId: job.id, prompt: open.prompt, answer: 'I will answer this after checking the role requirements.', state: 'answered' });
    assert.equal(answered.state, 'answered'); assert.equal(store.applicationQuestions(job.id)[0].answer.length > 0, true);
    const reusable = store.saveReusableAnswer('are you authorized to work', 'Are you authorized to work?', 'Yes');
    assert.equal(reusable.answer, 'Yes'); assert.equal(store.reusableAnswers()[0].question_key, 'are you authorized to work');
  } finally { store.close(); }
});
test('supervised application worker plans only reviewed factual fields and queues unknown required fields', () => {
  const profile = { name: 'Ada Lovelace', email: 'ada@example.test', phone: '+1 555 0100', linkedin: 'https://linkedin.com/in/ada' };
  assert.deepEqual(profileValues(profile), { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '+1 555 0100', linkedin: 'https://linkedin.com/in/ada' });
  assert.equal(fieldKind({ type: 'text', label: 'First name' }), 'firstName');
  assert.equal(fieldKind({ type: 'file', label: 'Resume' }), null);
  const plan = planFields([
    { selector: '#first', type: 'text', label: 'First name', visible: true },
    { selector: '#email', type: 'email', label: 'Email address', visible: true },
    { selector: '#cover', tag: 'textarea', label: 'Cover letter', required: true, visible: true },
    { selector: '#visa', type: 'text', label: 'Will you need sponsorship?', required: true, visible: true },
    { selector: '#filled', type: 'text', label: 'Phone', value: 'already there', visible: true }
  ], profile);
  assert.deepEqual(plan.fills.map(f => f.kind), ['firstName', 'email']);
  assert.deepEqual(plan.questions, ['Cover letter', 'Will you need sponsorship?']);
  const approved = planFields([{ selector: '#auth-no', type: 'radio', label: 'No', questionLabel: 'Are you authorized to work?', optionValue: 'no', visible: true, required: true }, { selector: '#auth-yes', type: 'radio', label: 'Yes', questionLabel: 'Are you authorized to work?', optionValue: 'yes', visible: true, required: true }], profile, new Map([['are you authorized to work', 'Yes']]));
  assert.deepEqual(approved.fills.map(f => [f.kind, f.selector]), [['approvedAnswer', '#auth-yes']]);
});
test('validated review refuses fabricated evidence and never authorizes applications', () => {
  const job = { ...fixture(), description: 'Python experience is required.' }; const profile = { text: 'Built Python models.' };
  const raw = { recommendation: 'strong', summary: 'Looks relevant.', requirements: [{ requirement: 'Python', status: 'supported', jobEvidence: 'Python experience is required.', profileEvidence: 'Built Python models.' }] };
  assert.equal(validateReview(raw, job, profile).recommendation, 'strong');
  raw.requirements[0].profileEvidence = 'Ten years at a hedge fund.';
  const result = validateReview(raw, job, profile);
  assert.equal(result.recommendation, 'unknown'); assert.equal(result.requirements[0].status, 'unknown');
  assert.equal(result.requirements[0].profileEvidence, ''); assert.equal(result.applicationAuthorized, false);
});
test('profile defaults to draft and lexical search still works with models disabled', async () => {
  const store = openStore(':memory:');
  try {
    saveProfile(store, { text: 'Built Python research models and SQL data pipelines for analysis.' });
    assert.equal(store.get('profile').approved, false);
    store.upsert(fixture()); store.upsert({ ...fixture(), id: 'different', canonical: 'different', title: 'ML Internship', kind: 'internship' });
    const result = await searchJobs(store, 'Quant', { kind: 'new-grad' }, false);
    assert.equal(result.total, 1); assert.equal(result.semanticIndexed, 0); assert.equal(result.jobs[0].title, 'Quant Researcher');
  } finally { store.close(); }
});
test('an explicit trading query is not diluted by resume data-science keywords', async () => {
  const store = openStore(':memory:');
  try {
    saveProfile(store, { text: 'Data science, statistics, Python, and SQL.' });
    store.upsert({ ...fixture(), id: 'trading', canonical: 'trading', title: 'Quantitative Trader', family: 'Quant' });
    store.upsert({ ...fixture(), id: 'science', canonical: 'science', title: 'Data Scientist', family: 'Data science', description: 'Data science and statistics.' });
    const result = await searchJobs(store, 'trading', { kind: 'new-grad' }, false);
    assert.equal(searchFamily('trading'), 'Quant'); assert.equal(result.intentFamily, 'Quant');
    assert.deepEqual(result.jobs.map(job => job.id), ['trading']);
  } finally { store.close(); }
});
test('source IDs resolve to real passages; unknown requirements cannot become strong fit', () => {
  const job = { ...fixture(), description: 'Python is required.\nA completed degree is required.' };
  const profile = { text: 'Built Python models.\nExpected graduation in 2027.' };
  const passages = { job: evidencePassages(job.description, 'J', 12000), profile: evidencePassages(profile.text, 'P', 6500) };
  const raw = { recommendation: 'strong', requirements: [{ requirement: 'Python', importance: 'required', status: 'supported', jobEvidenceId: 'J1', profileEvidenceId: 'P1' }, { requirement: 'Completed degree', importance: 'required', status: 'partial', jobEvidenceId: 'J2', profileEvidenceId: 'P2' }] };
  const result = validateReview(raw, job, profile, passages);
  assert.equal(result.recommendation, 'possible'); assert.equal(result.requirements[0].profileEvidence, 'Built Python models.');
  raw.requirements[0].profileEvidenceId = 'P999';
  assert.equal(validateReview(raw, job, profile, passages).recommendation, 'unknown');
  const unsupported = { recommendation: 'strong', requirements: [{ requirement: 'Python', status: 'unknown', jobEvidence: 'Python is required.', profileEvidence: '' }] };
  assert.equal(validateReview(unsupported, job, profile).recommendation, 'unknown');
  const repeated = { recommendation: 'strong', requirements: Array.from({ length: 4 }, (_, i) => ({ requirement: `Skill ${i}`, status: 'supported', jobEvidence: 'Python is required.', profileEvidence: 'Built Python models.' })) };
  assert.equal(validateReview(repeated, job, profile).recommendation, 'unknown');
});
test('Greenhouse public descriptions are sanitized and errors do not become closures', async () => {
  const original = globalThis.fetch; const store = openStore(':memory:');
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 123, title: 'Quant Researcher', content: '&lt;p&gt;Python required.&lt;/p&gt;', location: { name: 'New York' }, questions: [{ label: 'Name' }] }));
    const result = await fetchDetails(fixture()); assert.equal(result.status, 'open'); assert.equal(result.description, 'Python required.');
    globalThis.fetch = async () => new Response('', { status: 403 });
    const job = store.upsert(fixture()); const enriched = await enrichJobs(store, [job]);
    assert.equal(enriched.failed, 1); assert.equal(store.job(job.id).status, 'listed');
  } finally { globalThis.fetch = original; store.close(); }
});
test('Workday public endpoint 404 stays uncertain, not falsely closed', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(fetchDetails({ ...fixture(), platform: 'workday', url: 'https://example.wd1.myworkdayjobs.com/External/job/NY/Research_R1' }), /confirm whether the role is closed/);
    const gh = await fetchDetails(fixture()); assert.equal(gh.status, 'closed');
  } finally { globalThis.fetch = original; }
});
