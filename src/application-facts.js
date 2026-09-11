// Only reviewed facts, tied to the approved profile version, can supply answers.
export const demographicPrompt = /^(please select (your (gender|veteran status|disability status)|the (race\/ethnicity|veteran status|disability status))|what is your (veteran|disability|gender|race)|do you identify as (lgbtq\+|transgender)|how would you describe your (gender|racial|sexual)|are you a veteran|disability status|disability(?=\s*[*?:.]?\s*$)|gender|race\/ethnicity|veteran status)/i;
export const declineChoice = /^(i )?(prefer not to (answer|say|disclose)|decline to (answer|self[-\s]identify)|(do not|don['’]t) (wish|want) to (answer|disclose|self[-\s]identify)|choose not to (answer|disclose|self[-\s]identify))\b(.*)$/i;
export function factAnswer({ field, job, profile, facts }) {
  if (!profile?.approved || !facts?.reviewed || facts.profileHash !== profile.hash) return null;
  const prompt = field.prompt.replace(/\s*\*$/, '').trim();
  if (/^are you (at least )?18 years of age or older\?$/i.test(prompt) && typeof facts.ageAtLeast18 === 'boolean') return facts.ageAtLeast18 ? 'Yes' : 'No';
  if (job.scope === 'US' && facts.citizenship === 'US') {
    if (/^are you (legally )?authorized to work in (the (country where this job is located|united states)|the us|us|u\.s\.)\?$/i.test(prompt)) return 'Yes';
    if (/^will you now,? or in the future,? require sponsorship for employment visa status(?: \((?:i\.e\. H1B visa|e\.g\. H-1B visa status)\))?\?$/i.test(prompt)) return 'No';
  }
  // Greenhouse numbers repeated education controls. The reviewed facts describe
  // one education record, so never copy that record into a later school entry.
  const greenhouseEducation = [field.id, field.name].filter(Boolean).map(value => /^(school|degree|start-(?:date-)?year|end-(?:date-)?year)(?:--(\d+))?$/i.exec(value)).find(Boolean);
  if (greenhouseEducation) {
    if (greenhouseEducation[2] && Number(greenhouseEducation[2]) !== 0) return null;
    const kind = greenhouseEducation[1].toLowerCase();
    if (kind === 'school' && /^(school|school name:?)$/i.test(prompt)) return facts.school || null;
    if (kind === 'degree' && /^degree$/i.test(prompt)) return facts.degree || null;
    const month = /^start-/.test(kind) && /^start date year$/i.test(prompt) ? facts.educationStartMonth : /^end-/.test(kind) && /^end date year$/i.test(prompt) ? facts.graduationMonth : null;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return month.slice(0, 4);
  }
  if (/^what is your school\?/i.test(prompt) || /^(school name:?|school or university)$/i.test(prompt)) return facts.school || null;
  if (/^education-/.test(field.id || '')) {
    if (/^degree$/i.test(prompt)) return facts.degree || null;
    const month = /--firstYearAttended-/.test(field.id) ? facts.educationStartMonth : /--lastYearAttended-/.test(field.id) ? facts.graduationMonth : null;
    if (/^\d{4}-\d{2}$/.test(month || '') && field.automation === 'dateSectionYear-input') return month.slice(0, 4);
  }
  if (/^what is your (projected\/approximate|expected|projected) graduation date\?$/i.test(prompt) && /^\d{4}-\d{2}$/.test(facts.graduationMonth || '')) {
    const [year, month] = facts.graduationMonth.split('-');
    if (field.label === 'Month') return month;
    if (field.label === 'Year') return year;
    // A month-only estimate may use a representative day only when explicitly permitted.
    if (field.label === 'Day' && /approximate/i.test(prompt) && facts.approximateGraduationDay) return facts.approximateGraduationDay;
  }
  return null;
}
