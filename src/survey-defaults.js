// Explicit user opt-in, deliberately limited to recruitment-source surveys.
export function isSourceSurvey(prompt) {
  return /^(how did you (hear about|find) (us|this (job|position|opportunity))|where did you hear about (us|this (job|position|opportunity)))\??\s*\*?$/i.test(String(prompt).trim());
}
export function chooseSourceOption(labels) {
  const options = labels.map(s => s.trim()).filter(s => s && !/^(select( one)?|choose|back|previous)$/i.test(s));
  for (const preferred of [/^other$/i, /^(company|employer|corporate|careers?) (web\s*site|site)$/i, /careers? (web\s*site|site)$/i]) {
    const match = options.find(s => preferred.test(s));
    if (match) return match;
  }
  // The user permits an arbitrary available choice for this survey only.
  return options[0] || null;
}
