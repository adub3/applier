import test from 'node:test';
import assert from 'node:assert/strict';
import { routinePolicyAnswer, standingApplicationTermsAnswer } from '../src/application-consent.js';
test('routine acknowledgments require opt-in and exclude factual attestations and waivers', () => {
  const p = { routinePolicies: true };
  assert.equal(routinePolicyAnswer('I acknowledge DraftKings Personal Data Processing policy.*', p), 'Yes');
  assert.equal(routinePolicyAnswer('I accept the Privacy Policy', p), 'Yes');
  assert.equal(routinePolicyAnswer('I acknowledge DraftKings Personal Data Processing policy.*', {}), null);
  for (const text of ['I certify I am qualified', 'I agree to arbitration', 'I acknowledge marketing privacy policy', 'Are you authorized to work?', 'I acknowledge my information is accurate']) assert.equal(routinePolicyAnswer(text, p), null);
});

test('standing application terms require full mode, approved facts, opt-in and readable ordinary terms', () => {
  const input = { prompt: 'Yes, I have read and consent to the terms and conditions*', text: 'The details provided are truthful and correct. You consent to our Privacy Notice and affirm legal capacity to grant consent.', mode: 'full', preference: { applicationTerms: true }, profileApproved: true };
  assert.equal(standingApplicationTermsAnswer(input), 'Yes');
  for (const change of [{ mode: 'medium' }, { mode: 'none' }, { preference: {} }, { profileApproved: false }, { text: '' }, { prompt: 'Are you authorized to work?' }]) assert.equal(standingApplicationTermsAnswer({ ...input, ...change }), null);
  for (const extra of ['I agree to arbitration.', 'I waive my rights.', 'Pay an application fee.', 'Purchase a subscription.', 'Release of liability.', 'I consent to marketing.']) assert.equal(standingApplicationTermsAnswer({ ...input, text: input.text + ' ' + extra }), null);
});
