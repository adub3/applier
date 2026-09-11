import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../src/config.js';
import { publicError, publicData, UserFacingError } from '../src/errors.js';

test('technical network errors are logged and translated for the interface', () => {
  const raw = new Error('page.goto: net::ERR_NETWORK_ACCESS_DENIED at https://example.test Call log: internal traceback');
  const result = publicError(raw, 'test:network');
  assert.match(result.error, /blocked from opening/);
  assert.doesNotMatch(result.error, /page.goto|ERR_|Call log|traceback/);
  const logs = fs.readFileSync(path.join(DATA, 'logs', `errors-${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8');
  assert.ok(logs.includes(result.reference)); assert.ok(logs.includes('ERR_NETWORK_ACCESS_DENIED'));
});
test('validation stays readable; historic diagnostics do not leak into API responses', () => {
  assert.equal(publicError(new UserFacingError('Choose a resume.'), 'test:validation').error, 'Choose a resume.');
  const result = publicData({ state: 'paused', message: 'page.goto: net::ERR_NETWORK_ACCESS_DENIED', nested: { detailError: 'SQLITE traceback', semanticError: 'socket fail' } });
  assert.match(result.message, /blocked from opening/);
  assert.doesNotMatch(JSON.stringify(result), /SQLITE|socket fail|page.goto|ERR_/);
});
