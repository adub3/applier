import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

export const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
export const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export function plain(html) {
  const $ = cheerio.load(String(html ?? ''));
  $('script, style, noscript').remove();
  $('p,div,li,br,h1,h2,h3,h4').before('\n');
  return $.text().split('\n').map(clean).filter(Boolean).join('\n');
}
export function atsOf(value) {
  try {
    const h = new URL(value).hostname.toLowerCase();
    if (h === 'greenhouse.io' || h.endsWith('.greenhouse.io')) return 'greenhouse';
    if (h.endsWith('.myworkdayjobs.com') || h.endsWith('.myworkdaysite.com')) return 'workday';
    return 'other';
  } catch { return 'other'; }
}
export function publicUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Only ordinary HTTPS job links are supported.');
  if (!/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local')) throw new Error('Invalid public job hostname.');
  return u;
}
export function greenhouseTarget(value) {
  const u = publicUrl(value);
  if (!['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io', 'job-boards.eu.greenhouse.io'].includes(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const jobAt = parts.indexOf('jobs');
  const jobId = (jobAt >= 0 ? parts[jobAt + 1] : u.searchParams.get('gh_jid'));
  const board = parts[0] === 'embed' ? u.searchParams.get('for') : parts[0];
  if (!board || !/^[a-z0-9_-]+$/i.test(board) || !/^\d+$/.test(jobId ?? '')) return null;
  return { board, jobId, apiHost: u.hostname.includes('.eu.') ? 'boards-api.eu.greenhouse.io' : 'boards-api.greenhouse.io' };
}
export function workdayTarget(value) {
  const u = publicUrl(value);
  if (!/^[a-z0-9-]+(?:\.wd\d+)?\.myworkdayjobs\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const jobAt = parts.indexOf('job');
  if (jobAt < 1 || !parts[jobAt + 1]) return null;
  return { host: u.hostname, tenant: u.hostname.split('.')[0], site: parts[jobAt - 1], jobPath: parts.slice(jobAt).join('/') };
}
export function canonicalJob(value) {
  const u = publicUrl(value);
  const gh = greenhouseTarget(value);
  if (gh) return `greenhouse:${gh.apiHost}:${gh.board.toLowerCase()}:${gh.jobId}`;
  const wd = workdayTarget(value);
  if (wd) {
    const req = decodeURIComponent(u.pathname).match(/_(R|JR|REQ)[a-z0-9-]+$/i)?.[0];
    return `workday:${wd.tenant.toLowerCase()}:${req ? req.slice(1).toLowerCase() : wd.jobPath.toLowerCase()}`;
  }
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|source$|gh_src$|ref$)/i.test(key)) u.searchParams.delete(key);
  u.hash = '';
  return u.toString();
}
export function familyOf(title) {
  if (/quant|trading|systematic/i.test(title)) return 'Quant';
  if (/machine learning|\bml\b|\bai\b|artificial intelligence|deep learning/i.test(title)) return 'AI / ML';
  if (/data scien|statistic/i.test(title)) return 'Data science';
  if (/data engineer|analytics engineer/i.test(title)) return 'Data engineering';
  if (/research|scientist/i.test(title)) return 'Research';
  if (/analyst|analytics/i.test(title)) return 'Analytics';
  if (/software|developer|backend|engineer/i.test(title)) return 'Software';
  return 'Other';
}
export function levelOf(title, kind = '', description = '') {
  const heading = clean(title);
  const text = `${heading}\n${clean(description)}`;
  if (/\bintern(ship)?\b/i.test(heading) || kind === 'internship') return 'Internship';
  if (/\bsenior\b|\bsr[. ]|\bstaff\b|principal|director|manager|\blead\b/i.test(heading)) return 'Experienced';
  if (/new grad|graduate|entry.level|early career|junior|\bjr[. ]/i.test(heading)) return 'Early career';
  const years = [...text.matchAll(/\b(\d+)\s*(?:\+|[-–]\s*\d+)?\s+years?(?:\s+of)?\s+(?:relevant\s+|professional\s+|industry\s+|work\s+)?experience\b/gi)].map(match => Number(match[1]));
  if (years.some(value => value >= 3)) return 'Experienced';
  if (years.some(value => value <= 2) || /recent(?:ly)?\s+(?:graduated|graduate)|new[- ]graduate/i.test(text) || kind === 'new-grad') return 'Early career';
  return 'Unknown';
}
export function parseSalary(value) {
  const text = clean(value);
  const period = /\/hr|hour/i.test(text) ? 'hour' : /\/yr|year|annual/i.test(text) ? 'year' : 'unknown';
  const amounts = [...text.matchAll(/\$\s*([\d,.]+)\s*(k)?/gi)].map(m => Number(m[1].replaceAll(',', '')) * (m[2] ? 1000 : 1));
  return { salaryText: text, salaryMin: amounts.length ? Math.min(...amounts) : null, salaryMax: amounts.length ? Math.max(...amounts) : null, salaryPeriod: period, salaryCurrency: amounts.length ? 'USD' : 'unknown', salarySource: 'repository (not employer-verified)' };
}
function moneyValue(value) {
  const match = String(value ?? '').match(/\$?\s*([\d,.]+)\s*(k)?/i);
  return match ? Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1) : null;
}
export function employerSalary(text) {
  const lines = String(text ?? '').replace(/\b(?:US\$|USD\s*\$?)/gi, '$').split(/\r?\n/).map(clean).filter(Boolean);
  const value = lines.join('\n');
  const payLines = lines.filter(line => /\$\s*[\d,.]+\s*k?\s*(?:-|–|to)\s*\$\s*[\d,.]+\s*k?|(?:salary|compensation|pay|wage|rate)\b.*\$\s*[\d,.]+|\$\s*[\d,.]+.*\bUSD\b/i.test(line));
  const scope = payLines.join('\n') || value;
  const min = scope.match(/salary\s*(?:\/|or)?\s*rate\s*minimum\s*[:\-]?\s*([^\n]+)/i)?.[1] ?? scope.match(/(?:minimum|min)\s*(?:base\s*)?salary\s*[:\-]?\s*([^\n]+)/i)?.[1];
  const max = scope.match(/salary\s*(?:\/|or)?\s*rate\s*maximum\s*[:\-]?\s*([^\n]+)/i)?.[1] ?? scope.match(/(?:maximum|max)\s*(?:base\s*)?salary\s*[:\-]?\s*([^\n]+)/i)?.[1];
  // Keep period and currency evidence near the selected amount, not elsewhere in the description.
  const candidates = lines.flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z])/)).filter(line => !/\b(?:CAD|AUD|NZD|SGD|HKD)\b|(?:CA|AU|NZ|SG|HK|C|A)\$/i.test(line));
  const payLine = candidates.find(line => /\b(?:base|salary|pay|wage|rate|compensation)\b/i.test(line) && /\$\s*\d/.test(line))
    ?? candidates.find(line => /\$\s*\d/.test(line) && /per\s+(?:hour|year)|\/(?:hr|yr)\b|hourly|annually/i.test(line));
  const range = payLine?.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:-|–|—|to)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  const labeled = min && max && candidates.some(line => line.includes(min)) && candidates.some(line => line.includes(max));
  const values = labeled ? [moneyValue(min), moneyValue(max)] : range ? [Number(range[1].replaceAll(',', '')) * (range[2] ? 1000 : 1), Number(range[3].replaceAll(',', '')) * (range[4] ? 1000 : 1)] : payLine ? [moneyValue(payLine.match(/\$\s*[\d,.]+\s*k?/i)?.[0])] : [];
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  if (!values.length) return null;
  const evidence = labeled ? `${min}\n${max}` : payLine;
  const period = /\bhourly\b|per\s+hour\b|\/hr\b/i.test(evidence) ? 'hour' : /\b(annual|annually|yearly)\b|per\s+year\b|\/yr\b/i.test(evidence) ? 'year' : 'unknown';
  const salaryMin = Math.min(...values); const salaryMax = Math.max(...values);
  return { salaryText: `Employer posting: $${salaryMin.toLocaleString('en-US')}${salaryMin !== salaryMax ? `–$${salaryMax.toLocaleString('en-US')}` : ''}${period === 'year' ? ' per year' : period === 'hour' ? ' per hour' : ''}`, salaryMin, salaryMax, salaryPeriod: period, salaryCurrency: 'USD', salarySource: 'employer posting' };
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index); const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}
// A local comparison only; it intentionally does not claim to be third-party salary data.
export function marketSalaryEstimate(job, jobs) {
  if (job.salaryMax != null || job.kind === 'internship') return null;
  const company = clean(job.company).toLocaleLowerCase();
  const paid = jobs.filter(candidate => candidate.id !== job.id && clean(candidate.company).toLocaleLowerCase() === company && candidate.salaryPeriod === 'year' && candidate.salaryCurrency === 'USD' && Number.isFinite(candidate.salaryMin) && Number.isFinite(candidate.salaryMax) && candidate.salaryMin > 0 && candidate.salaryMax >= candidate.salaryMin);
  const tiers = [
    { label: 'same role family, career level, and region', test: c => c.family === job.family && c.level === job.level && c.scope === job.scope },
    { label: 'same role family, job type, and region', test: c => c.family === job.family && c.kind === job.kind && c.scope === job.scope },
    { label: 'same role family and region', test: c => c.family === job.family && c.scope === job.scope },
    { label: 'same role family', test: c => c.family === job.family }
  ];
  const match = tiers.map(tier => ({ ...tier, jobs: paid.filter(tier.test) })).find(tier => tier.jobs.length >= 2);
  if (!match) return null;
  const low = percentile(match.jobs.map(c => c.salaryMin), .25);
  const high = percentile(match.jobs.map(c => c.salaryMax), .75);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return null;
  const count = match.jobs.length;
  const examples = [...match.jobs].sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title)).slice(0, 5).map(candidate => ({ id: candidate.id, company: candidate.company, title: candidate.title, location: candidate.location, min: candidate.salaryMin, max: candidate.salaryMax, url: candidate.url }));
  return { min: low, max: high, currency: 'USD', period: 'year', sampleSize: count, confidence: count >= 10 ? 'higher' : count >= 4 ? 'moderate' : 'limited', basis: `same employer; ${match.label}`, source: 'local comparable listings', examples };
}
export function parseJobList(markdown, { file, sourceUrl, commit, fetchedAt = new Date().toISOString() }) {
  const kind = file.startsWith('NEW_GRAD') ? 'new-grad' : 'internship';
  const scope = file.includes('INTL') ? 'International' : 'US';
  const result = [];
  let company = '';
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replaceAll('\\|', '|'));
    if (cells.length < 5) continue;
    const postingAt = cells.length >= 6 ? 4 : 3;
    if (!cells[postingAt].includes('href=')) continue;
    const name = clean(plain(cells[0]));
    if (name && !/^[↳→\s]+$/.test(name)) company = name;
    const $ = cheerio.load(cells[postingAt]);
    const url = $('a[href]').first().attr('href');
    if (!url?.startsWith('https://')) continue;
    let canonical;
    try { canonical = canonicalJob(url); } catch { continue; }
    const title = clean(plain(cells[1]));
    const location = clean(plain(cells[2]));
    const age = clean(plain(cells[postingAt + 1]));
    result.push({ id: hash(canonical).slice(0, 24), canonical, url, company, title, location, kind, scope, platform: atsOf(url), family: familyOf(title), level: levelOf(title, kind), workMode: /\bremote\b/i.test(location) ? 'Remote' : /\bhybrid\b/i.test(location) ? 'Hybrid' : 'Unknown', ...parseSalary(postingAt === 4 ? plain(cells[3]) : ''), sourceUrl: `${sourceUrl}/blob/${commit}/${file}`, sourceCommit: commit, sourceAgeDays: /^\d+d$/.test(age) ? Number(age.slice(0, -1)) : null, sourceFetchedAt: fetchedAt, status: 'listed', description: '', detailsCheckedAt: null, requirements: [], sponsorship: 'unknown' });
  }
  return result;
}
const SKILLS = ['Python', 'C++', 'JavaScript', 'TypeScript', 'SQL', 'R', 'Java', 'MATLAB', 'PyTorch', 'TensorFlow', 'pandas', 'NumPy', 'scikit-learn', 'React', 'AWS', 'Docker', 'Kubernetes', 'Linux', 'Git', 'machine learning', 'deep learning', 'reinforcement learning', 'statistics', 'probability', 'optimization', 'time series', 'data analysis', 'research', 'algorithms', 'distributed systems', 'computer vision', 'natural language processing'];
export function skillsIn(text) {
  return SKILLS.filter(skill => new RegExp(`(?<![a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text));
}
export function matchesFilters(job, filters = {}) {
  if (job.status === 'closed' && !filters.includeClosed) return false;
  if (filters.platform && filters.platform !== 'all' && job.platform !== filters.platform) return false;
  if (filters.supportedOnly && !['greenhouse', 'workday'].includes(job.platform)) return false;
  for (const [key, field] of [['family', 'family'], ['kind', 'kind'], ['scope', 'scope'], ['level', 'level'], ['workMode', 'workMode']]) {
    if (filters[key] && filters[key] !== 'all' && job[field] !== filters[key]) return false;
  }
  if (filters.location && !job.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
  if (filters.excludePhdTitle && /\bph[.\s]*d\b|doctoral/i.test(job.title)) return false;
  if (filters.verifiedOnly && job.status !== 'open') return false;
  const floor = Number(filters.minSalary ?? 0);
  if (floor > 0 && (job.salaryPeriod !== 'year' || job.salaryCurrency !== 'USD' || job.salaryMax == null || job.salaryMax < floor)) return false;
  return true;
}
export function chunksFor(job) {
  const header = `${job.title}\nEmployer: ${job.company}\n${job.family}; ${job.level}; ${job.location}`;
  if (!job.description) return [header];
  const paragraphs = job.description.split(/\n+/).filter(Boolean);
  const chunks = [];
  let current = header;
  for (const paragraph of paragraphs) {
    for (let offset = 0; offset < paragraph.length; offset += 1800) {
      const part = paragraph.slice(offset, offset + 1800);
      if (current.length + part.length > 2400) { chunks.push(current); current = header; }
      current += `\n${part}`;
    }
  }
  if (current !== header) chunks.push(current);
  return chunks.length ? chunks : [header];
}
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : null;
}
export function fuseRanks(lists) {
  const scores = new Map();
  for (const list of lists) list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + index)));
  return scores;
}
