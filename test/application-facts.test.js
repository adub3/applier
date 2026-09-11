import test from 'node:test';
import assert from 'node:assert/strict';
import { factAnswer, demographicPrompt, declineChoice } from '../src/application-facts.js';
const profile = { approved: true, hash: 'reviewed' };
const facts = { reviewed: true, profileHash: 'reviewed', citizenship: 'US', school: 'Example University', graduationMonth: '2027-05', approximateGraduationDay: '01' };
const answer = (prompt, extra = {}, overrides = {}) => factAnswer({ field: { prompt, ...extra }, job: { scope: 'US' }, profile, facts, ...overrides });
test('education fields use reviewed school, degree and attendance years without assuming employment dates', () => {
  const education = { ...facts, degree: 'B.S.', educationStartMonth: '2023-08' };
  assert.equal(answer('School or University*'), 'Example University');
  assert.equal(answer('Degree*', { id: 'education-4--degree' }, { facts: education }), 'B.S.');
  assert.equal(answer('From', { id: 'education-4--firstYearAttended-dateSectionYear-input', automation: 'dateSectionYear-input' }, { facts: education }), '2023');
  assert.equal(answer('To (Actual or Expected)*', { id: 'education-4--lastYearAttended-dateSectionYear-input', automation: 'dateSectionYear-input' }), '2027');
  assert.equal(answer('To (Actual or Expected)*', { id: 'employment--endDate', automation: 'dateSectionYear-input' }), null);
});
test('reviewed citizenship supplies U.S. eligibility, not unknown or foreign eligibility', () => {
  const prompt = 'Are you legally authorized to work in the country where this job is located?*';
  assert.equal(answer(prompt), 'Yes');
  assert.equal(answer('Will you now or in the future require sponsorship for employment visa status (i.e. H1B visa)?*'), 'No');
  assert.equal(answer(prompt, {}, { job: { scope: 'Canada' } }), null);
  assert.equal(answer(prompt, {}, { facts: { ...facts, profileHash: 'old' } }), null);
  assert.equal(answer('Do you have a security clearance?'), null);
});
test('Greenhouse eligibility wording still requires reviewed U.S. facts and U.S. job scope', () => {
  const prompts = [
    ['Are you legally authorized to work in the United States?', 'Yes'],
    ['Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B visa status)?', 'No'],
  ];
  for (const [prompt, expected] of prompts) {
    assert.equal(answer(prompt), expected);
    for (const overrides of [{ job: { scope: 'Canada' } }, { job: {} }, { facts: { ...facts, citizenship: 'Canada' } }, { facts: { ...facts, reviewed: false } }, { facts: { ...facts, profileHash: 'old' } }, { profile: { ...profile, approved: false } }]) assert.equal(answer(prompt, {}, overrides), null);
  }
  for (const prompt of ['Are you legally authorized to work in Canada?', 'Will you now, or in the future, require sponsorship for security clearance?', 'Will you now, or in the future, require sponsorship for employment visa status and relocation assistance?']) assert.equal(answer(prompt), null);
});
test('Greenhouse education uses only the first recognized record and saved degree and years', () => {
  const education = { ...facts, degree: 'B.S.', educationStartMonth: '2023-08' };
  for (const [prompt, id, expected] of [
    ['School*', 'school--0', 'Example University'],
    ['Degree*', 'degree--0', 'B.S.'],
    ['Start date year*', 'start-year--0', '2023'],
    ['End date year*', 'end-year--0', '2027'],
    ['Start date year*', 'start-date-year--0', '2023'],
    ['End date year*', 'end-date-year--0', '2027'],
  ]) {
    assert.equal(answer(prompt, { id }, { facts: education }), expected);
    assert.equal(answer(prompt, { id: id.replace('--0', '--1') }, { facts: education }), null);
    assert.equal(answer(prompt, { id }, { facts: { ...education, reviewed: false } }), null);
  }
  assert.equal(answer('School*', { name: 'school' }), 'Example University');
  assert.equal(answer('Degree*', { name: 'degree' }, { facts: education }), 'B.S.');
  assert.equal(answer('Degree*', { id: 'degree--0' }), null);
  assert.equal(answer('Start date year*', { id: 'employment-start-year--0' }, { facts: education }), null);
  assert.equal(answer('End date year*', { id: 'end-year--0' }, { facts: { ...education, graduationMonth: '2027-13' } }), null);
  assert.equal(answer('Required degree for this role?', { id: 'degree--0' }, { facts: education }), null);
  assert.equal(answer('School Name', { id: 'school--1', name: 'school' }), null);
});
test('split graduation dates use known month/year; day convention only for approximate dates', () => {
  const prompt = 'What is your projected/approximate graduation date?*';
  assert.equal(answer(prompt, { label: 'Month' }), '05');
  assert.equal(answer(prompt, { label: 'Year' }), '2027');
  assert.equal(answer(prompt, { label: 'Day' }), '01');
  assert.equal(answer('What is your expected graduation date?', { label: 'Day' }), null);
});
test('demographic preference maps real decline options, never a substantive identity', () => {
  for (const prompt of ['Please select your gender.*', 'What is your veteran status?*', 'Do you identify as LGBTQ+?*', 'Please select your veteran status.*', 'Please select the veteran status that best describes you.*', 'Please select the veteran status which most accurately describes your status.', 'Please select your disability status.*', 'Disability*']) assert.ok(demographicPrompt.test(prompt), prompt);
  for (const option of ['I prefer not to disclose', 'Prefer not to answer', 'Decline to self-identify', 'I do not wish to self-identify', "I don't wish to answer", 'I don’t wish to answer', 'I do not want to answer', 'I choose not to self-identify']) assert.ok(declineChoice.test(option), option);
  for (const option of ['No, I am not a veteran', 'I am not a protected veteran', 'Yes, I have a disability', 'No, I do not have a disability', 'Male', 'Female']) assert.equal(declineChoice.test(option), false, option);
  for (const prompt of ['Please select your work authorization status.*', 'Disability accommodations needed?', 'Please select your veteran hiring preference eligibility.*', 'Please check one of the boxes below:']) assert.equal(demographicPrompt.test(prompt), false, prompt);
});
