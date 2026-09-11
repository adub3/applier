import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

// Opt-in live integration test: refreshes public data and runs local inference.
// It does not open employer accounts or submit applications.
const base = 'http://127.0.0.1:4317';
const html = await (await fetch(base)).text();
const token = html.match(/name="app-token" content="([a-f0-9]+)"/)?.[1];
assert.ok(token);
async function api(route, body) {
  const response = await fetch(`${base}/api${route}`, { method: body ? 'POST' : 'GET', headers: { 'x-app-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.ok(response.ok, data.error || `HTTP ${response.status}`);
  return data;
}
async function task(body) {
  const started = await api('/tasks', body);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const { task: current } = await api('/status');
    assert.equal(current.id, started.id);
    if (current.state !== 'running') {
      assert.equal(current.state, 'done', current.message);
      console.log(JSON.stringify({ action: body.action, state: current.state, result: body.action === 'review' ? { recommendation: current.result.recommendation, version: current.result.version, cached: current.result.cached } : current.result }));
      return current.result;
    }
    await setTimeout(500);
  }
  throw new Error(`Task ${body.action} timed out`);
}
const ids = ['70b7c10f1411b40d4057d570', 'ac2115cb1d5741d849ea75c7'];
await task({ action: 'refresh' });
const checked = await task({ action: 'enrich', ids, filters: { includeClosed: true }, limit: 2 });
assert.equal(checked.open, 2);
await task({ action: 'index', ids });
const review = await task({ action: 'review', id: ids[0] });
assert.equal(review.applicationAuthorized, false);
assert.ok(review.requirements.some(r => r.profileEvidence));
const status = await api('/status');
assert.equal(status.capabilities.automaticSubmission, false);
console.log(JSON.stringify({ passed: true, total: status.total, supported: status.supported, verified: status.verified, vectorJobs: status.vectorJobs, queued: status.queue }));
