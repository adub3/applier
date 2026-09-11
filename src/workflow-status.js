export function workflowStatus(state, blocker = null) {
  const stage = { opening: 'opening', signing_in: 'account', reading: 'application', filling: 'application', uploading: 'application', advancing: 'application', review: 'review', submitting: 'submission', email_verification: 'verification', submitted: 'confirmed', submission_unknown: 'confirmation_pending' }[state] || (blocker?.startsWith('portal_') || blocker === 'password_requirements' ? 'account' : 'application');
  const owner = blocker === 'missing_facts' ? 'user' : ['portal_credentials', 'password_requirements', 'security_check', 'account_terms'].includes(blocker) ? 'user' : blocker ? 'automation' : null;
  return { stage, blocker, blockerOwner: owner, completion: state === 'submitted' ? 'confirmed' : ['submitting','submission_unknown','email_verification'].includes(state) ? 'pending_confirmation' : 'not_submitted' };
}

export function classifyRequiredFields(fields, issues, canAnswer) {
  const automationIssues = new Set(issues);
  const questions = new Set();
  for (const field of fields) {
    if (!(field.visible || field.type === 'file') || !field.required || field.disabled || field.value || field.type === 'hidden') continue;
    const prompt = field.prompt || 'Unrecognized required field';
    if (!field.prompt || automationIssues.has(prompt) || canAnswer(field)) automationIssues.add(prompt);
    else questions.add(prompt);
  }
  return { questions: [...questions], automationIssues: [...automationIssues] };
}
