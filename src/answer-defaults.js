import { UserFacingError } from './errors.js';
const normal = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function employerHistoryQuestion(prompt, company) {
  const q = normal(prompt).split('?')[0].replace(/\*$/, '').trim().replace(/ or engaged as a contingent resource$/, '');
  return !!company && ['have you previously worked for ', 'have you ever worked for ', 'have you previously worked at ', 'have you ever worked at ', 'have you previously been employed by ', 'have you ever been employed by '].some(prefix => q === prefix + normal(company));
}
export function priorEmployerDefault({ prompt, company, history }) {
  if (!employerHistoryQuestion(prompt, company) || !history?.reviewed) return null;
  const found = history.entries.some(entry => [entry.employer, ...(entry.aliases || [])].some(name => normal(name) === normal(company)));
  return found ? 'Yes' : history.complete ? 'No' : null;
}
export function validateEmploymentHistory(input) {
  if (!Array.isArray(input?.entries) || input.entries.length > 50) throw new UserFacingError('Employment history must contain at most 50 entries.');
  const text = value => { if (typeof value !== 'string' || value.length > 250) throw new UserFacingError('Use short plain text for employment details.'); return value.trim(); };
  const entries = input.entries.map(entry => {
    if (!entry || !Array.isArray(entry.aliases) || entry.aliases.length > 20) throw new UserFacingError('Use at most 20 alternate employer names.');
    const employer = text(entry.employer); if (!employer) throw new UserFacingError('Each history entry needs an employer or institution name.');
    const start = text(entry.start || ''), end = text(entry.end || '');
    for (const date of [start, end]) if (date && !/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) throw new UserFacingError('Employment dates must use year and month.');
    if (start && end && start > end) throw new UserFacingError('An employment end date cannot be before its start date.');
    return { employer, aliases: [...new Set(entry.aliases.map(text).filter(Boolean))], title: text(entry.title || ''), start, end };
  });
  if (input.complete === true && input.reviewed !== true) throw new UserFacingError('Review the entries before confirming your history is complete.');
  return { entries, reviewed: input.reviewed === true, complete: input.complete === true, updatedAt: new Date().toISOString() };
}
