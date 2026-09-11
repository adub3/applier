// Keep the native select as the form value; present a consistent, accessible menu.
(() => {
  const controls = new Map();
  let nextId = 0;
  function sync() {
    for (const [select, control] of controls) {
      if (!select.isConnected) { control.menu.remove(); controls.delete(select); continue; }
      const label = select.selectedOptions[0]?.textContent || 'Select';
      if (control.button.textContent !== label) control.button.textContent = label;
      control.button.disabled = select.disabled;
    }
  }
  function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'select-text';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const label = select.labels?.[0];
    button.setAttribute('aria-label', select.getAttribute('aria-label') || (label ? [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim() : '') || 'Choose an option');
    const menu = document.createElement('div');
    menu.id = `select-menu-${++nextId}`; menu.className = 'select-menu'; menu.popover = 'auto';
    menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', button.getAttribute('aria-label'));
    button.setAttribute('aria-controls', menu.id);
    select.classList.add('native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    select.after(button); document.body.append(menu);
    controls.set(select, { button, menu });
    function close(focus = true) { menu.hidePopover(); if (focus) button.focus(); }
    function open() {
      sync(); menu.replaceChildren();
      for (const option of select.options) {
        if (option.hidden) continue;
        const item = document.createElement('button');
        item.type = 'button'; item.className = 'select-option'; item.textContent = option.textContent;
        item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
        item.tabIndex = -1; item.disabled = option.disabled || option.parentElement.disabled === true;
        item.onclick = () => {
          select.value = option.value; sync(); close();
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        };
        menu.append(item);
      }
      const rect = button.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 210), innerWidth - 32);
      const below = innerHeight - rect.bottom - 16;
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(16, Math.min(rect.left - 12, innerWidth - width - 16))}px`;
      menu.style.top = below >= 180 ? `${rect.bottom + 6}px` : 'auto';
      menu.style.bottom = below >= 180 ? 'auto' : `${innerHeight - rect.top + 6}px`;
      menu.style.maxHeight = `${Math.max(100, Math.min(320, below >= 180 ? below : rect.top - 22))}px`;
      menu.showPopover(); button.setAttribute('aria-expanded', 'true');
      (menu.querySelector('[aria-selected=true]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
    }
    button.onclick = () => menu.matches(':popover-open') ? close() : open();
    button.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); open(); }
    };
    menu.addEventListener('toggle', event => button.setAttribute('aria-expanded', String(event.newState === 'open')));
    menu.onkeydown = event => {
      const items = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement);
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') { close(); }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
        next = items.findIndex((item, i) => i > index && item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
        if (next < 0) next = items.findIndex(item => item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
      }
      if (next != null && next >= 0 && items[next]) { event.preventDefault(); items[next].focus(); }
    };
    select.addEventListener('change', sync);
    select.addEventListener('input', sync);
  }
  function refresh() { document.querySelectorAll('select').forEach(enhance); sync(); }
  window.refreshSelectMenus = refresh;
  refresh();
  new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && (record.target.matches('select') || record.target.closest('select')) || [...record.addedNodes].some(node => node instanceof Element && (node.matches('select') || node.querySelector('select'))))) refresh();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  addEventListener('resize', () => { for (const { menu } of controls.values()) if (menu.matches(':popover-open')) menu.hidePopover(); });
})();

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const token = $('meta[name="app-token"]').content;
class UiError extends Error {}
function logClientError(error) {
  console.error('[Job Desk]', error);
  // Best effort: avoid recursive error reporting when the server is unreachable.
  fetch('/api/client-error', { method: 'POST', headers: { 'x-app-token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(error?.stack || error?.message || error).slice(0, 4000) }) }).catch(() => {});
}
function showError(error) {
  logClientError(error);
  notice(error instanceof UiError ? error.message : 'Something went wrong. Please refresh the page and try again.', true);
}
window.addEventListener('error', event => showError(event.error || new Error('Unexpected browser error')));
window.addEventListener('unhandledrejection', event => { event.preventDefault(); showError(event.reason); });
const defaults = { kind: 'new-grad', scope: 'US', supportedOnly: true, platform: 'all', family: 'all', workMode: 'all', query: '' };
const state = { all: [], ranked: null, searchMeta: null, view: 'discover', limit: 40, profile: null, status: null, selected: null, taskKey: null, searchVersion: 0, searching: false, applications: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = value => Number(value ?? 0).toLocaleString();
const date = value => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet';
const money = value => Number(value).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 0 });
const initial = company => String(company || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const tone = company => [...String(company)].reduce((n, c) => n + c.charCodeAt(0), 0) % 6;
const answerKey = value => String(value ?? '').replace(/^portal question:\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const platformLabel = value => ({ greenhouse: 'Greenhouse', workday: 'Workday', other: 'Other' }[value] || 'Other');
const applicationStatus = value => ({ planning: 'Planning', in_progress: 'In progress', paused: 'Paused', ready_for_review: 'Ready to review', submission_unknown: 'Sent; confirmation pending', submitted: 'Receipt confirmed', done: 'Done' }[value] || 'Planning');
function salaryLabel(job) {
  if (job.salaryMax) return `${job.salaryPeriod === 'year' ? '' : 'Pay: '}$${money(job.salaryMin)}${job.salaryMin !== job.salaryMax ? `–${money(job.salaryMax)}` : ''}${job.salaryPeriod === 'hour' ? '/hr' : job.salaryPeriod === 'year' ? '/yr' : ''}`;
  const estimate = job.salaryEstimate;
  return estimate ? `Est. $${money(estimate.min)}–${money(estimate.max)}` : '';
}
function levelsFyiUrl(job) {
  const name = String(job.company || '').toLowerCase().trim();
  const aliases = { 'chicago trading company': 'chicago-trading' };
  const company = aliases[name] || name.replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (!company) return null;
  // Verified Levels.fyi taxonomy: CTC's quant researcher data is filed under Data Scientist.
  if (company === 'chicago-trading' && /quantitative\s+research/i.test(job.title)) return `https://www.levels.fyi/companies/${company}/salaries/data-scientist/title/quantitative-researcher`;
  const role = ({ 'Data science': 'data-scientist', Software: 'software-engineer', 'AI / ML': 'machine-learning-engineer', Analytics: 'data-analyst', 'Data engineering': 'data-engineer' }[job.family]);
  // The company overview is safer than inventing an unverified title URL.
  return `https://www.levels.fyi/companies/${company}/salaries${role ? `/${role}` : ''}`;
}
function external(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? esc(u.href) : '#'; } catch { return '#'; } }
function platform(job) { return `<span class="platform ${['greenhouse', 'workday'].includes(job.platform) ? job.platform : 'other'}">${platformLabel(job.platform)}</span>`; }
async function api(url, body) {
  let response, data;
  try {
    response = await fetch(`/api${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-app-token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    data = await response.json();
  } catch (error) {
    logClientError(error);
    throw new UiError('The app could not be reached. Check that it is running, then try again.');
  }
  if (!response.ok) throw new UiError(data.error || 'This action could not be completed. Please try again.');
  return data;
}
function notice(message, error = false, kind = 'success') { const box = $('#notice'); box.classList.remove('hidden'); box.classList.toggle('error', error); box.classList.toggle('success', !error && kind === 'success'); box.setAttribute('role', error ? 'alert' : 'status'); box.innerHTML = `<button aria-label="Dismiss message">×</button>${esc(message)}`; box.querySelector('button').onclick = () => box.classList.add('hidden'); }
async function run(work, button) { if (button) button.disabled = true; try { return await work(); } catch (error) { showError(error); } finally { if (button) button.disabled = false; } }
function readFilters() {
  const p = $('#platform').value;
  return { kind: $('#kind').value, scope: $('#scope').value, family: $('#family').value, platform: ['greenhouse', 'workday'].includes(p) ? p : 'all', supportedOnly: p !== 'any', workMode: $('#workMode').value, location: $('#location').value.trim(), minSalary: Number($('#minSalary').value || 0), excludePhdTitle: $('#excludePhdTitle').checked, verifiedOnly: $('#verifiedOnly').checked };
}
function fillFilters(filters) {
  const f = { ...defaults, ...filters };
  for (const key of ['kind', 'scope', 'family', 'workMode']) $(`#${key}`).value = f[key] || 'all';
  $('#platform').value = ['greenhouse', 'workday'].includes(f.platform) ? f.platform : f.supportedOnly === false ? 'any' : 'all';
  $('#location').value = f.location || ''; $('#minSalary').value = f.minSalary || '';
  $('#excludePhdTitle').checked = !!f.excludePhdTitle; $('#verifiedOnly').checked = !!f.verifiedOnly; $('#query').value = f.query || '';
}
function matches(job, f) {
  if (job.status === 'closed') return false;
  if (f.supportedOnly && !['greenhouse', 'workday'].includes(job.platform)) return false;
  for (const key of ['kind', 'scope', 'family', 'platform', 'workMode']) if (f[key] && f[key] !== 'all' && job[key] !== f[key]) return false;
  if (f.location && !job.location.toLowerCase().includes(f.location.toLowerCase())) return false;
  if (f.excludePhdTitle && /\bph[.\s]*d\b|doctoral/i.test(job.title)) return false;
  if (f.verifiedOnly && job.status !== 'open') return false;
  if (f.minSalary > 0 && (job.salaryPeriod !== 'year' || job.salaryCurrency !== 'USD' || job.salaryMax == null || job.salaryMax < f.minSalary)) return false;
  return true;
}
function fitBadge(job) {
  const labels = { strong: 'Promising fit', possible: 'Possible fit', weak: 'Significant gaps', unknown: 'Needs review' };
  if (job.reviewRecommendation) return `<span class="fit-badge ${esc(job.reviewRecommendation)}">✧ ${labels[job.reviewRecommendation] || 'Needs review'}</span><span class="evidence-sub">Local model assessment</span>`;
  if (job.semanticSimilarity != null) return `<span class="fit-badge semantic" title="Embedding cosine similarity × 100. This is relevance, not a hiring probability.">↗ ${Math.round(job.semanticSimilarity * 100)} similarity</span><span class="evidence-sub">${job.descriptionLength ? 'Full description indexed' : 'Listing only · not verified'}</span>`;
  return `<span class="fit-badge ${job.status === 'open' ? '' : 'unknown'}">${job.status === 'open' ? '✓ Page checked' : job.status === 'closed' ? 'No longer listed' : 'Not checked'}</span><span class="evidence-sub">${job.status === 'open' ? 'Fit not analyzed yet' : 'Listing metadata only'}</span>`;
}
function renderJobs() {
  window.refreshSelectMenus?.();
  const f = readFilters();
  let jobs = state.view === 'shortlist' ? state.all.filter(j => j.queueState) : (state.ranked || state.all).filter(j => matches(j, f));
  jobs = [...jobs];
  if ($('#sort').value === 'newest') jobs.sort((a, b) => (a.sourceAgeDays ?? 9999) - (b.sourceAgeDays ?? 9999));
  else if ($('#sort').value === 'company') jobs.sort((a, b) => a.company.localeCompare(b.company));
  const visible = jobs.slice(0, state.limit);
  $('#results-count').textContent = count(jobs.length);
  $('#showing-count').textContent = jobs.length ? `Showing ${count(visible.length)} of ${count(jobs.length)} roles` : 'No roles to display';
  $('#load-more').classList.toggle('hidden', visible.length >= jobs.length);
  $('#empty-state').classList.toggle('hidden', !!jobs.length);
  $('.table-wrap').classList.toggle('hidden', !jobs.length);
  $('#empty-state h3').textContent = state.view === 'shortlist' ? 'No saved roles' : 'No roles in this view';
  $('#empty-state p').textContent = state.view === 'shortlist' ? 'Save a role from Jobs to keep it here.' : 'Try a wider role family, region, or job type.';
  $('#jobs-body').innerHTML = visible.map(j => `<tr tabindex="0" data-job="${esc(j.id)}" aria-label="View ${esc(j.title)} at ${esc(j.company)}"><td><button class="save-job ${j.queueState ? 'saved' : ''}" data-save="${esc(j.id)}" aria-label="${j.queueState ? 'Remove from' : 'Add to'} shortlist: ${esc(j.title)}" aria-pressed="${!!j.queueState}">${j.queueState ? '★' : '☆'}</button></td><td class="role-cell"><div class="job-identity"><span class="company-mark tone-${tone(j.company)}" aria-hidden="true">${esc(initial(j.company))}</span><div><span class="role-name">${esc(j.title)}</span><div class="company-name">${esc(j.company)}${salaryLabel(j) ? ` <span class="salary-inline ${j.salaryEstimate ? 'estimated' : ''}">· ${salaryLabel(j)}</span>` : ''}</div></div></div></td><td class="location-cell">${esc(j.location || 'Not specified')}</td><td>${platform(j)}</td><td class="evidence-cell">${fitBadge(j)}</td><td class="age-cell" title="Age recorded by the repository when imported; not independently verified">${j.sourceAgeDays == null ? '—' : `${count(j.sourceAgeDays)}d`}</td></tr>`).join('');
  const meta = state.searchMeta;
  $('#ranking-note').textContent = state.view === 'shortlist' ? '' : meta ? `${meta.semanticIndexed ? 'Ranked by relevance' : 'Keyword results'}${meta.semanticError ? ' / semantic search unavailable' : ''}` : '';
}
async function refreshJobs() { state.all = (await api('/jobs')).jobs; state.ranked = null; state.searchMeta = null; renderJobs(); }
function renderStatus(data) {
  state.status = data;
  for (const [selector, n] of [['#stat-total', data.total], ['#stat-supported', data.supported], ['#stat-verified', data.verified], ['#stat-queue', data.queue], ['#nav-total', data.total], ['#nav-queue', data.queue], ['#nav-questions', data.applicationQuestions]]) $(selector).textContent = count(n);
  const source = data.source;
  $('#source-info').innerHTML = source ? `<dt>Last import</dt><dd>${esc(date(source.at))}</dd><dt>Repository version</dt><dd>${esc(source.commit.slice(0, 12))}</dd><dt>Unique listings</dt><dd>${count(source.uniqueJobs)}</dd>` : '<dt>No source imported yet</dt><dd>Pull the repository to get started.</dd>';
  const models = data.models;
  const present = name => models?.models?.some(m => m.name === name);
  $('#model-info').innerHTML = [['Embeddings', models?.embeddingModel], ['Fit review', models?.reviewModel]].map(([label, name]) => `<div class="model-row">${present(name) ? '<span class="status-dot"></span>' : '○ '}${esc(label)}<small>${esc(name || 'Not configured')} · ${present(name) ? 'Installed' : 'Unavailable'}</small></div>`).join('') + `<p class="muted">${count(data.vectorJobs)} jobs in the local vector index</p>`;
  const running = data.task?.state === 'running';
  $('#task-banner').classList.toggle('hidden', !running);
  $('#task-message').textContent = data.task?.message || '';
  for (const selector of ['#refresh-button', '#source-refresh', '#source-enrich', '#source-index']) $(selector).disabled = running;
  $$('[data-task]').forEach(button => { button.disabled = running || button.dataset.unavailable === 'true'; });
}
async function pollStatus() {
  try {
    const data = await api('/status'); renderStatus(data);
    const key = data.task ? `${data.task.id}:${data.task.state}` : null;
    if (state.taskKey !== null && key !== state.taskKey && data.task?.state !== 'running') {
      if (data.task?.state === 'done') {
        const r = data.task.result;
        notice(data.task.name === 'Check employer pages' ? `Checked ${r.checked} pages: ${r.open} open, ${r.closed} no longer listed, ${r.failed} could not be checked.` : data.task.name === 'Prepare semantic search' ? `Semantic search is ready. ${r.indexed} jobs updated; ${r.cached} already indexed.` : `${data.task.name} complete.`, Number(r.failed) > 0);
        await refreshJobs();
        if (state.selected) await openJob(state.selected);
      } else if (data.task?.state === 'failed' || data.task?.state === 'interrupted') notice(data.task.message, true);
    }
    state.taskKey = key;
  } catch (error) { if (!state.status) showError(error); }
}
function setView(view) {
  if (!['discover', 'shortlist', 'profile', 'applications', 'history', 'sources'].includes(view)) return;
  state.view = view; state.limit = 40; document.body.dataset.view = view;
  $$('.nav-item').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $$('.view').forEach(section => section.classList.toggle('hidden', section.id !== `${['discover', 'shortlist'].includes(view) ? 'discover' : view}-view`));
  $('#breadcrumb').innerHTML = `WORKSPACE <span>/</span> ${esc({ discover: 'DISCOVER', shortlist: 'SHORTLIST', profile: 'MY PROFILE', applications: 'ACTIVE APPLICATION', history: 'PAST APPLICATIONS', sources: 'SOURCES & MODELS' }[view])}`;
  $('#page-title').innerHTML = view === 'shortlist' ? 'Shortlist' : 'Jobs';
  $('#page-subtitle').textContent = view === 'shortlist' ? 'Your saved opportunities, all in one thoughtful little list.' : 'A clearer view of the roles that fit your experience.';
  $('#results-title').firstChild.textContent = view === 'shortlist' ? 'Saved roles ' : 'Roles ';
  if (view === 'profile') run(loadProfile);
  if (['applications', 'history', 'profile'].includes(view)) run(loadApplications);
  if (['discover', 'shortlist'].includes(view)) renderJobs();
  history.replaceState(null, '', `#${view}`);
}
function draftCard(draft) {
  const job = draft.job;
  if (!job) return '';
  return `<article class="application-card tracker-card" data-draft="${esc(draft.job_id)}"><div class="tracker-card-head"><div><h3>${esc(job.title)}</h3><p class="muted">${esc(job.company)} · updated ${esc(date(draft.updated_at))}</p></div><span class="tracker-status ${esc(draft.state)}">${esc(applicationStatus(draft.state))}</span></div><div class="tracker-controls"><label>Status<select data-draft-state><option value="planning" ${draft.state === 'planning' ? 'selected' : ''}>Planning</option><option value="in_progress" ${draft.state === 'in_progress' ? 'selected' : ''}>In progress</option><option value="paused" ${draft.state === 'paused' ? 'selected' : ''}>Needs my input</option><option value="ready_for_review" ${draft.state === 'ready_for_review' ? 'selected' : ''}>Ready for my review</option><option value="submitted" ${draft.state === 'submitted' ? 'selected' : ''}>Submitted</option><option value="done" ${draft.state === 'done' ? 'selected' : ''}>Done / closed</option></select></label><a class="button secondary" href="${external(job.url)}" target="_blank" rel="noopener noreferrer">Employer page ↗</a><button class="button secondary" data-save-draft="${esc(draft.job_id)}">Save</button></div><details class="tracker-details"><summary>Notes & portal question</summary><label>Notes<textarea data-draft-notes rows="2" placeholder="What to check before you apply…">${esc(draft.notes)}</textarea></label><label>Add a portal question<textarea data-new-question rows="2" placeholder="e.g. What is your desired salary?"></textarea></label><button class="button secondary" data-add-question="${esc(draft.job_id)}">Add to question inbox</button></details></article>`;
}
function questionCard(question) {
  const job = question.job;
  const reusable = state.applications?.reusableAnswers?.some(answer => answer.question_key === answerKey(question.prompt));
  return `<article class="application-card question-card" data-question="${question.id}"><h3>${esc(job?.title || 'Removed job')}</h3><p class="muted">${esc(job?.company || 'Job unavailable')} · added ${esc(date(question.created_at))}</p><label>Portal question<textarea data-question-prompt rows="3">${esc(question.prompt)}</textarea></label><label>Your reviewed answer<textarea data-question-answer rows="4" placeholder="Write the answer you want used. Leave blank to keep this open.">${esc(question.answer)}</textarea></label><label class="check-label"><input data-question-reusable type="checkbox" ${reusable ? 'checked' : ''}> Reuse this exact answer for matching questions</label><div class="drawer-actions"><span class="detail-tag ${question.state === 'answered' ? '' : 'attention'}">${question.state === 'answered' ? 'ANSWERED' : 'NEEDS ANSWER'}</span><button class="button secondary" data-save-question="${question.id}" data-question-job="${esc(question.job_id)}">Save answer</button></div></article>`;
}
function reusableAnswerCard(answer) { return `<article class="application-card"><h3>${esc(answer.prompt)}</h3><p class="muted">Reusable exact answer · updated ${esc(date(answer.updated_at))}</p><details><summary>Show saved answer</summary><p>${esc(answer.answer)}</p></details></article>`; }
function renderApplications() {
  const data = state.applications || { drafts: [], questions: [] };
  const openQuestions = data.questions.filter(q => q.state === 'needs_answer');
  $('#application-drafts').innerHTML = data.drafts.length ? data.drafts.map(draftCard).join('') : '<div class="review-callout">Open a role from Discover or Shortlist and choose <strong>Prepare application</strong> to create a supervised prep record.</div>';
  for (const draft of data.drafts) if (draft.state === 'submission_unknown') {
    const select = $(`[data-draft="${draft.job_id}"] [data-draft-state]`);
    if (select) { select.add(new Option('Submission needs checking', 'submission_unknown', true, true)); }
  }
  $('#application-questions').innerHTML = openQuestions.length ? openQuestions.map(questionCard).join('') : '<div class="review-callout">All caught up. Answered questions are saved in your local application-answers.md file.</div>';
  $('#application-questions').previousElementSibling.textContent = 'Answer a question here to save it to local Markdown and clear it from this inbox. Then Resume the browser workflow.';
  let saved = $('#saved-application-answers');
  if (!saved) {
    saved = document.createElement('details'); saved.id = 'saved-application-answers';
    $('#application-questions').after(saved);
    saved.onclick = e => { const button = e.target.closest('[data-save-question]'); if (button) run(() => saveQuestion(button), button); };
  }
  const answered = data.questions.filter(q => q.state === 'answered');
  saved.innerHTML = `<summary>Saved answers (${answered.length})</summary><div class="application-list">${answered.map(questionCard).join('')}</div>`;
  saved.hidden = !answered.length;
  $('#reusable-answers').innerHTML = data.reusableAnswers?.length ? data.reusableAnswers.map(reusableAnswerCard).join('') : '<div class="review-callout">Save an answered question as reusable to build this library.</div>';
  const open = data.questions.filter(question => question.state === 'needs_answer').length;
  $('#question-count').textContent = `${open} OPEN`;
}
async function loadApplications() {
  const applications = await api('/applications');
  state.applications = applications; renderApplications();
  setupBrowserControls();
  renderBrowserSession(await api('/application-browser'));
}
async function saveApplicationDocument(kind) {
  const selector = kind === 'context' ? '#application-context' : '#application-instructions';
  await api('/application-documents', { kind, text: $(selector).value });
  notice(`${kind === 'context' ? 'Context' : 'Instructions'} saved locally as Markdown.`);
}
async function createApplicationDraft(jobId) {
  const existing = (await api('/applications')).drafts.find(d => d.job_id === jobId);
  if (!existing) await api('/applications', { jobId, state: 'planning', notes: '' });
  closeDrawer();
  state.applications = null; setView('applications'); await loadApplications();
  notice('Application prep started. Review the employer page and add any unanswered form questions here.');
}
function setupBrowserControls() {
  if (!$('#browser-controls')) {
    const section = document.createElement('section'); section.className = 'panel browser-controls'; section.id = 'browser-controls';
    section.innerHTML = `<h2>Greenhouse automation</h2><p class="muted">Choose an application and the details to send. Full fills the form and opens the application; submission happens when you confirm below.</p><div class="browser-fields"><label>Application<select id="browser-job"></select></label><label>Automation<select id="browser-mode"><option value="full">Full — fill, upload, advance</option><option value="medium">Medium — fill and upload</option><option value="none">None — inspect only</option></select></label><label>Application email<input id="browser-email" type="email" placeholder="Your alternate email" autocomplete="off"></label><label>First name<input id="browser-first"></label><label>Last name<input id="browser-last"></label><label>Resume for this run<input id="browser-resume" type="file" accept=".pdf,.docx,.txt"></label></div><div class="drawer-actions"><button class="button primary" data-browser-action="start">Start browser</button><button class="button secondary" data-browser-action="resume">Resume / refresh review</button><button class="button secondary" data-browser-action="close">Close session</button></div><div id="browser-session" role="status" aria-live="polite"></div>`;
    $('#applications-view .page-heading').after(section);
    section.querySelector('h2').textContent = 'Application automation';
    section.querySelector('p').textContent = 'Full mode fills, uploads, advances, and submits with your approved answers. Missing answers pause the run. Medium mode stops for your review.';
    $('#browser-mode option[value="full"]').textContent = 'Full — fill, upload, advance, submit';
    section.querySelector('[data-browser-action="start"]').textContent = 'Start application';
    const pause = document.createElement('button'); pause.className = 'button secondary'; pause.dataset.browserAction = 'pause'; pause.textContent = 'Pause / Take control'; section.querySelector('.drawer-actions').append(pause);
    const observer = document.createElement('details'); observer.id = 'browser-observer'; observer.open = true;
    observer.innerHTML = '<summary>Watch application browser</summary><p class="muted">This preview is view-only. To edit the employer form, click Pause and wait for control to be handed to you.</p><img id="browser-preview" alt="Live preview of the employer application" hidden>';
    section.append(observer);
    let previewBusy = false;
    setInterval(async () => {
      if (previewBusy || state.view !== 'applications' || !observer.open) return;
      previewBusy = true;
      try {
        const [session, preview] = await Promise.all([api('/application-browser'), api('/application-browser/preview')]);
        if (session) renderBrowserSession(session);
        if (preview.image) { $('#browser-preview').src = preview.image; $('#browser-preview').hidden = false; }
        else $('#browser-preview').hidden = true;
      } catch { /* Action requests handle user-facing errors. */ }
      finally { previewBusy = false; }
    }, 1500);
    section.onclick = e => { const b = e.target.closest('[data-browser-action]'); if (b) run(() => browserAction(b.dataset.browserAction), b); };
  }
  const select = $('#browser-job'), previous = select.value;
  select.innerHTML = '<option value="">Select a prepared Greenhouse or Workday role</option>' + (state.applications?.drafts || []).filter(d => ['greenhouse','workday'].includes(d.job?.platform)).map(d => `<option value="${esc(d.job_id)}">${esc(d.job.company)} — ${esc(d.job.title)}</option>`).join('');
  select.value = previous;
}
function renderBrowserSession(session) {
  if (session?.state === 'email_verification' && document.activeElement?.id === 'email-verification-code') return;
  const codeInput = session?.id === state.browserSession?.id ? $('#email-verification-code') : null;
  state.browserSession = session;
  const stageLabels = { opening: 'Opening employer page', account: 'Portal account', application: 'Application form', review: 'Final review', submission: 'Sending application', verification: 'Verification pending', confirmed: 'Receipt confirmed', confirmation_pending: 'Sent; confirmation pending' };
  $('#browser-session').innerHTML = session ? `<h3>${esc(session.company)} · ${esc(session.title)}</h3><p>${esc(session.message)}</p><p class="muted">${esc(session.email)} · Resume: ${esc(session.resume || 'none selected')} · ${esc(session.state)}</p>${session.missing?.length ? `<ul>${session.missing.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}${session.actions?.length ? `<details><summary>Actions taken</summary><ul>${session.actions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}${session.state === 'review' ? '<button class="button primary" data-browser-action="submit">Confirm & submit this application</button>' : ''}` : '<p class="muted">Select your application email and resume above to begin.</p>';
  if (session?.stage) $('#browser-session').insertAdjacentHTML('afterbegin', `<p class="muted">${esc(stageLabels[session.stage] || 'Application workflow')}</p>`);
  if (session?.automationIssues?.length && session.blocker === 'form_controls') $('#browser-session').insertAdjacentHTML('beforeend', `<details><summary>Automation needs attention—not missing answers</summary><ul>${session.automationIssues.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>`);
  if (session?.state === 'email_verification') {
    $('#browser-session').insertAdjacentHTML('beforeend', `${session.codeEntry ? '<label>Email verification code<input id="email-verification-code" type="password" autocomplete="off" aria-label="Email verification code"></label><button class="button primary" data-browser-action="verify-email">Verify code</button>' : ''}<button class="button secondary" data-browser-action="resume">Check verification</button><p class="muted">Automatic email verification is WIP. Open your email normally and enter the code here. Codes are never saved to your profile or Markdown.</p>`);
    if (codeInput && $('#email-verification-code')) $('#email-verification-code').replaceWith(codeInput);
  }
}
async function browserAction(action) {
  const body = { action };
  if (action === 'pause') { renderBrowserSession(await api('/application-browser', body)); return; }
  if (action === 'start') {
    body.autoSubmit = $('#browser-mode').value === 'full';
    Object.assign(body, { jobId: $('#browser-job').value, mode: $('#browser-mode').value, email: $('#browser-email').value.trim(), firstName: $('#browser-first').value.trim(), lastName: $('#browser-last').value.trim() });
  }
  if (action === 'start' || action === 'resume') {
    const file = $('#browser-resume').files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) throw new UiError('Choose a resume smaller than 10 MB.');
      body.resume = { name: file.name, base64: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new UiError('Cannot read resume.')); reader.readAsDataURL(file); }) };
    }
  }
  if (action === 'submit') body.revision = state.browserSession?.revision;
  if (action === 'verify-email') { body.code = $('#email-verification-code').value; $('#email-verification-code').value = ''; }
  const buttons = $$('#browser-controls button'); buttons.forEach(b => { b.disabled = b.dataset.browserAction !== 'pause'; });
  let polling = true, timer;
  $('#browser-session').textContent = action === 'start' ? 'Opening the application browser…' : 'Working on your application…';
  async function refreshProgress() {
    try { const session = await api('/application-browser'); if (polling && session) renderBrowserSession(session); } catch { /* The action request reports connection failures. */ }
    if (polling) timer = setTimeout(refreshProgress, 750);
  }
  timer = setTimeout(refreshProgress, 750);
  try { renderBrowserSession(await api('/application-browser', body)); await loadApplications(); }
  finally { polling = false; clearTimeout(timer); $$('#browser-controls button').forEach(b => { b.disabled = false; }); }
}
async function saveDraft(button) {
  const card = button.closest('[data-draft]');
  await api('/applications', { jobId: card.dataset.draft, state: card.querySelector('[data-draft-state]').value, notes: card.querySelector('[data-draft-notes]').value });
  await loadApplications(); notice('Application prep saved locally.');
}
async function addQuestion(button) {
  const card = button.closest('[data-draft]'); const prompt = card.querySelector('[data-new-question]').value;
  await api('/application-questions', { jobId: card.dataset.draft, prompt, answer: '', state: 'needs_answer' });
  await loadApplications(); await pollStatus(); notice('Question added to your inbox.');
}
async function saveQuestion(button) {
  const card = button.closest('[data-question]'); const answer = card.querySelector('[data-question-answer]').value.trim();
  const prompt = card.querySelector('[data-question-prompt]').value;
  await api('/application-questions', { id: Number(card.dataset.question), jobId: button.dataset.questionJob, prompt, answer, state: answer ? 'answered' : 'needs_answer' });
  if (card.querySelector('[data-question-reusable]').checked) {
    if (!answer) throw new UiError('Write an answer before marking it reusable.');
    await api('/reusable-answers', { questionKey: answerKey(prompt), prompt: prompt.replace(/^Portal question:\s*/i, ''), answer });
  }
  await loadApplications(); await pollStatus(); notice(answer ? 'Answer saved to application-answers.md and removed from the open inbox.' : 'Question kept open for your answer.');
}
async function exportApplications() {
  const { csv } = await api('/applications/export', {});
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'application-tracker.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function findMatches() {
  const version = ++state.searchVersion; state.searching = true;
  const button = $('#match-button'); button.disabled = true; button.innerHTML = '<span class="spinner"></span> Searching';
  try {
    const data = await api('/search', { query: $('#query').value, filters: readFilters() });
    if (version !== state.searchVersion) return;
    state.ranked = data.jobs; state.searchMeta = data; state.limit = 40; renderJobs();
    if (data.semanticError) notice(`Keyword results are available. Semantic search: ${data.semanticError}`, true);
    else if (!data.semanticIndexed && data.total) notice('These are keyword-ranked results. Prepare semantic search in Settings to compare jobs by meaning.', false, 'info');
  } finally { state.searching = false; button.disabled = false; button.innerHTML = 'Search'; }
}
async function toggleSave(id) {
  const job = state.all.find(j => j.id === id); if (!job) return;
  const data = await api('/queue', { id, remove: !!job.queueState });
  job.queueState = data.saved ? 'shortlisted' : null;
  const ranked = state.ranked?.find(j => j.id === id); if (ranked) ranked.queueState = job.queueState;
  if (state.status) renderStatus({ ...state.status, queue: state.all.filter(j => j.queueState).length });
  renderJobs();
  if (state.selected === id) await openJob(id);
}
function reviewHtml(review) {
  const label = { strong: 'Promising fit', possible: 'Possible fit', weak: 'Significant gaps', unknown: 'Needs your review' }[review.recommendation] || 'Needs your review';
  return `<div class="model-review"><span class="fit-badge ${esc(review.recommendation)}">✧ ${label}</span><p>${esc(review.summary)}</p>${review.strengths?.length ? `<h4>Where you align</h4><ul>${review.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}${review.gaps?.length ? `<h4>Gaps & things to confirm</h4><ul>${review.gaps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}${(review.requirements || []).map(r => `<details class="review-evidence"><summary>${esc(r.requirement)} · ${esc(r.status)}</summary><span class="evidence-label">Employer evidence</span><blockquote>${esc(r.jobEvidence || 'No exact supporting passage was validated.')}</blockquote><span class="evidence-label">Your resume</span><blockquote>${esc(r.profileEvidence || 'No exact supporting passage was validated.')}</blockquote><p class="detail-note">${r.evidenceVerified ? 'Evidence text was found in the supplied documents. The interpretation still needs your review.' : 'Insufficient validated evidence. Do not treat this as a confirmed qualification.'}</p></details>`).join('')}<p class="detail-note">${esc(review.model)} · ${esc(date(review.reviewedAt))}${review.inputTruncated ? ' · Input shortened; assessment is incomplete.' : ''}<br>Model-generated interpretation, not an eligibility decision or hiring probability.</p></div>`;
}
async function openJob(id) {
  const wasOpen = !!state.selected;
  state.selected = id;
  $('#job-drawer').classList.remove('hidden'); $('#drawer-backdrop').classList.remove('hidden'); document.body.classList.add('drawer-open');
  if (!wasOpen) { $('#drawer-content').innerHTML = '<div class="drawer-section muted">Loading the full picture…</div>'; $('#close-drawer').focus(); }
  const job = await api(`/jobs/${id}`); if (state.selected !== id) return;
  const supported = ['greenhouse', 'workday'].includes(job.platform);
  const canReview = job.status === 'open' && job.description && state.status?.profile;
  const glance = `<section class="drawer-section at-a-glance"><h3>At a glance</h3><dl><div><dt>Work type</dt><dd>${esc(job.kind === 'new-grad' ? 'New graduate / full-time' : 'Internship')}</dd></div><div><dt>Seniority</dt><dd>${esc(job.level)}</dd></div><div><dt>Arrangement</dt><dd>${esc(job.workMode)}</dd></div><div><dt>Requirements found</dt><dd>${count(job.requirements?.length)}${job.description ? '' : ' · check page first'}</dd></div><div><dt>Source age</dt><dd>${job.sourceAgeDays == null ? 'Not recorded' : `${count(job.sourceAgeDays)} days`}</dd></div></dl></section>`;
  const estimate = job.salaryEstimate;
  const levelsLink = levelsFyiUrl(job);
  const comparableLinks = estimate?.examples?.length ? `<details class="estimate-sources"><summary>View ${count(estimate.examples.length)} same-employer paid listings in this catalog</summary><ul>${estimate.examples.map(example => `<li><a href="${external(example.url)}" target="_blank" rel="noopener noreferrer">${esc(example.company)} · ${esc(example.title)} ↗</a><span>$${money(example.min)}${example.min !== example.max ? `–${money(example.max)}` : ''} · ${esc(example.location || 'location not listed')}</span></li>`).join('')}</ul><p>Showing 5 of ${count(estimate.sampleSize)} local records. These are secondary context, not a salary estimate.</p></details>` : '';
  const paySection = job.salaryText ? `<section class="drawer-section"><h3>Compensation in posting</h3><p class="muted">${esc(job.salaryText)}</p><p class="detail-note">${job.salarySource === 'employer posting' ? 'Extracted from the employer description. The posting did not state a period unless shown above; verify the pay type and total compensation on the employer page.' : 'Repository data, not employer-verified. Check the original posting.'}</p>${levelsLink ? `<a class="levels-link" href="${external(levelsLink)}" target="_blank" rel="noopener noreferrer">View ${esc(job.company)} pay on Levels.fyi ↗</a>` : ''}</section>` : `<section class="drawer-section salary-estimate"><h3>Compensation <span class="detail-tag">EXTERNAL REFERENCE</span></h3>${levelsLink ? `<a class="levels-link primary-levels-link" href="${external(levelsLink)}" target="_blank" rel="noopener noreferrer">View ${esc(job.company)} pay on Levels.fyi ↗</a><p class="detail-note">Levels.fyi is the primary compensation reference here. When the company and title path is verified, this opens it directly; otherwise it opens the company salary overview rather than guessing a title page. Verify location, level, and total-comp details there.</p>` : '<p class="detail-note">No pay was listed. Check the employer page or a salary-data service directly.</p>'}${comparableLinks}</section>`;
  $('#drawer-content').innerHTML = `<div class="drawer-kicker"><span class="company-mark tone-${tone(job.company)}">${esc(initial(job.company))}</span>${esc(job.company)}<span>·</span>${platform(job)}</div><h2>${esc(job.title)}</h2><p class="drawer-location">${esc(job.location || 'Location not specified')}</p><div class="drawer-tags"><span class="detail-tag">${esc(job.kind === 'new-grad' ? 'New graduate / full-time' : 'Internship')}</span><span class="detail-tag">${esc(job.family)}</span><span class="detail-tag">${job.status === 'open' ? '✓ Employer page checked' : job.status === 'closed' ? 'No longer listed' : 'Availability not verified'}</span></div><div class="drawer-actions"><a class="button primary" href="${external(job.url)}" target="_blank" rel="noopener noreferrer">Open employer page ↗</a><button class="button secondary" data-drawer-save="${job.id}">${job.queueState ? '★ Saved to shortlist' : '☆ Save to shortlist'}</button><button class="button secondary" data-prepare="${job.id}">✓ Prepare application</button>${supported ? `<button class="button secondary" data-task="enrich" data-id="${job.id}">↻ Check page</button>` : ''}</div>${glance}<section class="drawer-section"><h3>Your fit <span class="detail-tag">LOCAL MODEL</span></h3>${job.review ? reviewHtml(job.review) : `<div class="review-callout">${canReview ? 'Compare the employer’s requirements with your resume. The local model will highlight alignment, gaps, and source evidence.' : !state.status?.profile ? 'Add your resume in My profile to compare this role with your experience.' : job.status === 'closed' ? 'This role is no longer available on the checked employer endpoint.' : 'Check the employer page first. A meaningful fit review needs the actual job description.'}${supported ? `<br><button class="button secondary" data-task="review" data-id="${job.id}" data-unavailable="${!canReview}" ${canReview ? '' : 'disabled'}>✧ Analyze my fit</button>` : ''}</div>`}<p class="detail-note">Your resume ${state.status?.profile?.approved ? 'is marked reviewed' : 'is a draft and still needs your accuracy check'}. Sponsorship, work authorization, and all eligibility decisions need your confirmation.</p></section><section class="drawer-section"><h3>Job description</h3>${job.detailError ? `<p class="notice error">Last check could not complete: ${esc(job.detailError)}. You can inspect the employer page directly.</p>` : ''}<p class="detail-note">${job.detailsCheckedAt ? `Last checked ${esc(date(job.detailsCheckedAt))}. Availability can change.` : 'Not yet checked against the employer site.'}</p>${job.description ? `<div class="description-text">${esc(job.description)}</div>` : '<div class="review-callout">Check the employer page to load the description.</div>'}</section>${paySection}<div class="drawer-bottom">Source: <a href="${external(job.sourceUrl)}" target="_blank" rel="noopener noreferrer">repository snapshot ↗</a><br>${esc(job.details?.method || 'Listing metadata only')}<br>Application prep saves only to this computer. You open the employer page and remain responsible for every answer and final submission.</div>`;
  $$('[data-task]').forEach(button => { button.disabled = state.status?.task?.state === 'running' || button.dataset.unavailable === 'true'; });
}
function closeDrawer() { const id = state.selected; state.selected = null; $('#job-drawer').classList.add('hidden'); $('#drawer-backdrop').classList.add('hidden'); document.body.classList.remove('drawer-open'); if (id) $(`[data-job="${id}"]`)?.focus(); }
async function startTask(action, id) {
  const body = { action, filters: readFilters() };
  if (id) { body.id = id; body.ids = [id]; body.filters = { includeClosed: true }; }
  const task = await api('/tasks', body);
  state.taskKey = `${task.id}:running`; renderStatus({ ...state.status, task });
}
async function loadProfile() {
  if (!$('#profile-addressLine1')) {
    for (const [key, title] of [['addressLine1','Street address'], ['addressLine2','Apartment / unit'], ['city','City'], ['state','State / region'], ['postalCode','ZIP / postal code']]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.id = 'profile-' + key; label.append(input);
      $('#save-profile').before(label);
    }
  }
  if (!$('#portal-account-panel')) {
    const panel = document.createElement('section'); panel.id = 'portal-account-panel'; panel.className = 'panel';
    panel.innerHTML = '<h2>Portal account</h2><p class="muted">Use these details for employer account creation and sign-in, not Gmail. Passwords are protected by Windows and never put in Markdown or logs.</p><label>Account email<input id="portal-email" type="email" autocomplete="username"></label><label>Account password<input id="portal-password" type="password" autocomplete="new-password"></label><p id="portal-password-status" class="muted"></p><label class="check-label"><input id="portal-enabled" type="checkbox"> Allow employer account creation and sign-in</label><button id="save-portal-account" class="button secondary">Save portal account</button>';
    $('#profile-view').append(panel);
    $('#save-portal-account').onclick = e => run(async () => {
      const input = { email: $('#portal-email').value.trim(), password: $('#portal-password').value || undefined, enabled: $('#portal-enabled').checked };
      try { await api('/portal-account', input); await loadProfile(); notice('Portal account saved securely.'); }
      finally { $('#portal-password').value = ''; }
    }, e.currentTarget);
  }
  if (!$('#application-consent-panel')) {
    const panel = document.createElement('section'); panel.id = 'application-consent-panel'; panel.className = 'panel';
    panel.innerHTML = '<h2>Application terms</h2><label class="check-label"><input id="application-terms-enabled" type="checkbox" aria-describedby="application-terms-description"> Accept ordinary Workday application terms in Full Auto</label><p id="application-terms-description" class="muted">I authorize the bot to accept ordinary truthfulness, privacy, and legal-capacity declarations on my behalf using my approved facts. This is a standing approval for future Workday Full Auto applications; I can turn it off here. It does not authorize invented eligibility answers, fees, arbitration, waivers, or unrelated commitments.</p><p id="application-terms-status" class="muted" role="status"></p><button id="save-application-consent" class="button secondary">Save application terms preference</button>';
    $('#profile-view').append(panel);
    $('#save-application-consent').onclick = e => run(async () => {
      await api('/application-consent', { applicationTerms: $('#application-terms-enabled').checked });
      await loadProfile(); notice('Application terms preference saved privately.');
    }, e.currentTarget);
  }
  const account = await api('/portal-account');
  $('#portal-email').value = account.email;
  $('#portal-enabled').checked = account.enabled;
  $('#portal-password').value = '';
  $('#portal-password-status').textContent = account.hasPassword ? 'Password saved. Leave blank to keep it.' : 'No password saved.';
  const [profile, documents, employment, consent] = await Promise.all([api('/profile'), api('/application-documents'), api('/employment-history'), api('/application-consent')]); state.profile = profile;
  $('#application-terms-enabled').checked = consent.applicationTerms;
  $('#application-terms-status').textContent = `${consent.applicationTerms ? 'Standing approval is on for Workday Full Auto.' : 'Standing approval is off. The bot will ask before accepting these terms.'}${consent.updatedAt ? ` Saved ${date(consent.updatedAt)}.` : ''}`;
  renderEmploymentHistory(employment);
  for (const key of ['text', 'name', 'email', 'phone', 'linkedin', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode']) $(`#profile-${key}`).value = profile[key] || '';
  $('#profile-approved').checked = !!profile.approved;
  $('#resume-source').textContent = profile.sourceName ? `${profile.sourceName} · ${profile.approved ? 'Marked accurate by you' : 'Draft — please check the extracted text'}` : 'Import a PDF or TXT resume. It stays on this computer.';
  $('#application-context').value = documents.context;
  $('#application-instructions').value = documents.instructions;
}
async function saveProfile() {
  const input = Object.fromEntries(['text', 'name', 'email', 'phone', 'linkedin', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'].map(key => [key, $(`#profile-${key}`).value]));
  input.approved = $('#profile-approved').checked;
  await api('/profile', input); await loadProfile(); await refreshJobs(); await pollStatus(); notice('Profile saved locally. Search again to update your ranking.');
}
async function uploadResume(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) throw new UiError('Choose a resume smaller than 10 MB.');
  const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new UiError('The resume could not be read.')); reader.readAsDataURL(file); });
  await api('/profile/upload', { name: file.name, base64 }); await loadProfile(); await refreshJobs(); await pollStatus(); notice('Resume imported locally. Check the extracted text and contact details before marking it accurate.');
}
$('.sidebar nav').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('#search-form').onsubmit = e => { e.preventDefault(); run(findMatches); };
$('.quick-lanes').onclick = e => { const b = e.target.closest('[data-lane]'); if (!b || state.searching) return; $('#query').value = b.dataset.lane; $$('[data-lane]').forEach(x => x.classList.toggle('selected', x === b)); run(findMatches); };
$('.filters').addEventListener('input', () => { state.searchVersion++; state.ranked = null; state.searchMeta = null; state.limit = 40; renderJobs(); });
$('#reset-filters').onclick = () => { fillFilters(defaults); state.searchVersion++; state.ranked = null; state.searchMeta = null; state.limit = 40; renderJobs(); };
$('#toggle-filters').onclick = () => { const open = $('.filters').classList.toggle('expanded'); $('#toggle-filters').setAttribute('aria-expanded', String(open)); $('#toggle-filters').textContent = open ? 'Hide filters −' : 'Show filters +'; };
$('#save-filters').onclick = e => run(async () => { await api('/filters', { ...readFilters(), query: $('#query').value }); notice('Search preferences saved. They will be here when you come back.'); }, e.currentTarget);
$('#sort').onchange = renderJobs;
$('#load-more').onclick = () => { state.limit += 40; renderJobs(); };
$('#jobs-body').onclick = e => { const save = e.target.closest('[data-save]'); if (save) return run(() => toggleSave(save.dataset.save), save); const row = e.target.closest('[data-job]'); if (row) run(() => openJob(row.dataset.job)); };
$('#jobs-body').onkeydown = e => { if (e.key === 'Enter' && e.target.matches('[data-job]')) run(() => openJob(e.target.dataset.job)); };
$('#close-drawer').onclick = closeDrawer; $('#drawer-backdrop').onclick = closeDrawer;
document.addEventListener('keydown', e => {
  if (!state.selected) return;
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Tab') {
    const items = [...$('#job-drawer').querySelectorAll('button:not(:disabled),a[href],summary')].filter(el => el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
});
$('#drawer-content').onclick = e => { const task = e.target.closest('[data-task]'); if (task) return run(() => startTask(task.dataset.task, task.dataset.id), task); const save = e.target.closest('[data-drawer-save]'); if (save) return run(() => toggleSave(save.dataset.drawerSave), save); const prepare = e.target.closest('[data-prepare]'); if (prepare) run(() => createApplicationDraft(prepare.dataset.prepare), prepare); };
$('#refresh-button').onclick = e => run(() => startTask('refresh'), e.currentTarget);
$('#source-refresh').onclick = e => run(() => startTask('refresh'), e.currentTarget);
$('#source-enrich').onclick = e => run(() => startTask('enrich'), e.currentTarget);
$('#source-index').onclick = e => run(() => startTask('index'), e.currentTarget);
$('#save-profile').onclick = e => run(saveProfile, e.currentTarget);
$('#resume-upload').onchange = e => run(() => uploadResume(e.target.files[0])).finally(() => { e.target.value = ''; });
$('#save-application-context').onclick = e => run(() => saveApplicationDocument('context'), e.currentTarget);
$('#save-application-instructions').onclick = e => run(() => saveApplicationDocument('instructions'), e.currentTarget);
$('#export-applications').onclick = e => run(exportApplications, e.currentTarget);
$('#application-drafts').onclick = e => { const save = e.target.closest('[data-save-draft]'); if (save) return run(() => saveDraft(save), save); const add = e.target.closest('[data-add-question]'); if (add) run(() => addQuestion(add), add); };
$('#application-questions').onclick = e => { const save = e.target.closest('[data-save-question]'); if (save) run(() => saveQuestion(save), save); };
async function boot() {
  setupApplicationPages();
  $('#jobs-body').innerHTML = '<tr class="boot-row"><td colspan="6">Opening your local workspace…</td></tr>';
  const results = await Promise.allSettled([api('/filters'), api('/jobs'), api('/status')]);
  if (results[0].status === 'fulfilled') fillFilters({ ...results[0].value, query: '' }); else fillFilters(defaults);
  if (results[1].status === 'fulfilled') state.all = results[1].value.jobs;
  if (results[2].status === 'fulfilled') { renderStatus(results[2].value); const t = results[2].value.task; state.taskKey = t ? `${t.id}:${t.state}` : null; }
  for (const result of results) if (result.status === 'rejected') showError(result.reason);
  setView(location.hash.slice(1) || 'discover'); renderJobs();
  await run(loadProfile);
  // Recursive scheduling prevents overlapping status requests when Ollama is slow.
  async function poll() { await pollStatus(); setTimeout(poll, 2500); } setTimeout(poll, 2500);
}
run(boot);

function setupApplicationPages() {
  const employmentPanel = document.createElement('section'); employmentPanel.className = 'panel application-work';
  employmentPanel.innerHTML = '<h2>Employment & research history</h2><p class="muted">The source of truth for prior-employer questions. Alternate names are exact aliases, not automatically inferred subsidiaries.</p><div id="employment-entries"></div><button id="add-employment" class="button secondary">Add employer</button><label class="check-label"><input id="employment-reviewed" type="checkbox"> I have checked these entries for accuracy.</label><label class="check-label"><input id="employment-complete" type="checkbox"> This is my complete employment and research history. Use No for unlisted employers.</label><button id="save-employment" class="button primary">Save employment history</button>';
  $('#profile-view').append(employmentPanel);
  $('#add-employment').onclick = () => { $('#employment-entries').insertAdjacentHTML('beforeend', employmentCard({})); $('#employment-reviewed').checked = false; $('#employment-complete').checked = false; };
  $('#employment-entries').oninput = () => { $('#employment-reviewed').checked = false; $('#employment-complete').checked = false; };
  $('#employment-entries').onclick = e => { if (e.target.closest('[data-remove-employment]')) { e.target.closest('[data-employment-entry]').remove(); $('#employment-reviewed').checked = false; $('#employment-complete').checked = false; } };
  $('#save-employment').onclick = e => run(async () => {
    const entries = $$('[data-employment-entry]').map(card => Object.fromEntries(['employer','title','start','end','aliases'].map(key => [key, key === 'aliases' ? card.querySelector(`[data-employment-${key}]`).value.split(';').map(s => s.trim()).filter(Boolean) : card.querySelector(`[data-employment-${key}]`).value])));
    const saved = await api('/employment-history', { entries, reviewed: $('#employment-reviewed').checked, complete: $('#employment-complete').checked }); renderEmploymentHistory(saved); notice('Employment history saved. Future employer-history answers will use these facts.');
  }, e.currentTarget);
  const historyView = document.createElement('section'); historyView.id = 'history-view'; historyView.className = 'view hidden';
  historyView.innerHTML = '<div class="page-heading"><div><h1>Past applications</h1><p class="subtitle">Your application records, including runs still in progress.</p></div></div>';
  historyView.append($('#application-drafts').closest('section.panel'));
  $('#applications-view').after(historyView);
  const nav = document.createElement('button'); nav.className = 'nav-item'; nav.dataset.view = 'history'; nav.innerHTML = '<span>◷</span> Past applications';
  $('[data-view="applications"]').after(nav);
  $('#profile-view').append($('#reusable-answers').closest('section.panel'));
  $('#applications-view .profile-grid').style.gridTemplateColumns = '1fr';
  $('#applications-view .subtitle').textContent = 'Watch the active run and answer anything it needs from you.';
  $('#profile-view .profile-note p').textContent = 'Saving a profile does not apply anywhere. Starting Full automation fills and submits using your approved answers; Medium stops for review.';
  const panel = document.createElement('section'); panel.className = 'panel application-work'; panel.id = 'gmail-panel';
  panel.innerHTML = '<h2>Automatic email verification <span class="detail-tag">WIP</span></h2><p class="muted">Work in progress. For now, open your email in your normal browser and paste the verification code into the active application when asked.</p>';
  $('#profile-view').append(panel);
}
function employmentCard(entry) {
  return `<div class="application-card" data-employment-entry><label>Employer / institution<input data-employment-employer value="${esc(entry.employer || '')}"></label><label>Role<input data-employment-title value="${esc(entry.title || '')}"></label><label>Start month<input type="month" data-employment-start value="${esc(entry.start || '')}"></label><label>End month (blank if unknown or ongoing)<input type="month" data-employment-end value="${esc(entry.end || '')}"></label><label>Alternate employer names (separated by semicolons)<input data-employment-aliases value="${esc((entry.aliases || []).join('; '))}"></label><button class="button secondary" data-remove-employment>Remove entry</button></div>`;
}
function renderEmploymentHistory(history) {
  if (!$('#employment-entries')) return;
  $('#employment-entries').innerHTML = history.entries.map(employmentCard).join('');
  $('#employment-reviewed').checked = !!history.reviewed; $('#employment-complete').checked = !!history.complete;
}
