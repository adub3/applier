// Opt-in applies only to routine acknowledgments, not factual attestations.
export function routinePolicyAnswer(prompt, preference) {
  if (!preference?.routinePolicies) return null;
  const text = String(prompt).replace(/\s*\*$/, '').trim();
  if (/\b(certify|accurate|qualified|eligible|arbitration|waive|marketing|sponsorship|authorized to work)\b/i.test(text)) return null;
  return /^(i acknowledge|do you acknowledge|i agree to|i accept)\s+(?:[\w’' -]+\s+)?(?:personal data processing policy|privacy (?:policy|notice)|job applicant privacy policy)\.?\??$/i.test(text) ? 'Yes' : null;
}

export function isApplicationTermsPrompt(prompt) {
  return /^(yes,? )?i (have read and consent to|agree to|accept) (the )?(application )?terms and conditions\W*$/i.test(String(prompt).trim());
}

// Standing permission covers ordinary application declarations, not unrelated
// contractual commitments. Read the displayed terms, never the checkbox alone.
export function standingApplicationTermsAnswer({ prompt, text, mode, preference, profileApproved }) {
  if (mode !== 'full' || preference?.applicationTerms !== true || !profileApproved || !isApplicationTermsPrompt(prompt)) return null;
  const terms = String(text || '').replace(/\s+/g, ' ').trim();
  if (!terms || /\b(arbitration|waiv\w*|class.action|non.?compete|pay(?:ment|able)?|fees?|purchase|subscription|credit card|background check authorization|release of liability|marketing)\b/i.test(terms)) return null;
  const truthful = /(?:truthful and correct|true and (?:complete|correct)|accurate and complete|information.{0,50}(?:accurate|truthful))/i.test(terms);
  const privacy = /privacy (?:notice|policy)|personal data (?:processing|protection)/i.test(terms);
  return truthful && privacy ? 'Yes' : null;
}
