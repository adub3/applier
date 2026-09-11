import test from 'node:test';
import assert from 'node:assert/strict';
import { isSourceSurvey, chooseSourceOption } from '../src/survey-defaults.js';
import { priorEmployerDefault } from '../src/answer-defaults.js';
test('source-survey defaults are narrow and choose only offered options', () => {
  assert.equal(isSourceSurvey('How Did You Hear About Us?*'), true);
  assert.equal(isSourceSurvey('Where did you hear about this position?'), true);
  for (const prompt of ['Are you authorized to work?', 'What is your veteran status?', 'Have you worked here?', 'Postal Code*']) assert.equal(isSourceSurvey(prompt), false);
  assert.equal(chooseSourceOption(['Select One', 'LinkedIn', 'Other']), 'Other');
  assert.equal(chooseSourceOption(['Job Boards', 'Company Website']), 'Company Website');
  assert.equal(chooseSourceOption(['Event', 'Referral']), 'Event');
  assert.equal(chooseSourceOption(['Select One']), null);
});
test('combined employee/contingent-resource wording uses reviewed complete work history', () => {
  const history = { reviewed: true, complete: true, entries: [{ employer: 'Example', aliases: [] }] };
  assert.equal(priorEmployerDefault({ prompt: 'Have you previously been employed by Another or engaged as a contingent resource?*', company: 'Another', history }), 'No');
  assert.equal(priorEmployerDefault({ prompt: 'Have you previously been employed by Example or engaged as a contingent resource?*', company: 'Example', history }), 'Yes');
  assert.equal(priorEmployerDefault({ prompt: 'Have you previously been employed by Another or engaged as a contingent resource?*', company: 'Another', history: { ...history, complete: false } }), null);
});
