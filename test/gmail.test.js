import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GmailConnection, verificationCode } from '../src/gmail.js';

const credentials = { installed: { client_id: '123-test.apps.googleusercontent.com', client_secret: 'test-secret' } };
const criteria = { email: 'alternate@example.test', since: Date.now() - 10000, company: 'Fixture Company', title: 'Data Analyst' };
function message(text = 'Fixture Company verification code: 654321') {
  return { internalDate: String(Date.now()), payload: { mimeType: 'text/plain', headers: [
    { name: 'From', value: 'Greenhouse <no-reply@us.greenhouse-mail.io>' },
    { name: 'To', value: criteria.email },
    { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@us.greenhouse-mail.io;' },
    { name: 'Subject', value: 'Verify application' }
  ], body: { data: Buffer.from(text).toString('base64url') } } };
}
test('codes require recent, authenticated, employer-matched mail to the application address', () => {
  assert.equal(verificationCode(message(), criteria), '654321');
  assert.equal(verificationCode(message(), { ...criteria, since: Date.now() + 1000 }), null);
  assert.equal(verificationCode(message(), { ...criteria, email: 'other@example.test' }), null);
  assert.equal(verificationCode(message('Generic sign in verification code: 654321'), criteria), null);
  assert.equal(verificationCode(message('Fixture Company verification code: 654321 security code: 123456'), criteria), null);
  const forged = message(); forged.payload.headers[0].value = 'no-reply@greenhouse-mail.io.evil.test';
  assert.equal(verificationCode(forged, criteria), null);
  const unauthenticated = message(); unauthenticated.payload.headers[2].value = 'mx.google.com; dkim=fail header.i=@greenhouse-mail.io;';
  assert.equal(verificationCode(unauthenticated, criteria), null);
  unauthenticated.payload.headers[2].value = 'mx.google.com; dkim=pass header.i=@evil.test; dkim=fail header.i=@greenhouse-mail.io;';
  assert.equal(verificationCode(unauthenticated, criteria), null);
  const html = message(); html.payload.mimeType = 'text/html'; html.payload.body.data = Buffer.from('<p>Fixture Company verification code: <b>654321</b></p>').toString('base64url');
  assert.equal(verificationCode(html, criteria), '654321');
});

function connection() {
  const calls = [];
  const gmail = new GmailConnection({ redirectUri: 'http://127.0.0.1:4317/oauth/gmail/callback', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return Response.json({ access_token: 'PRIVATE_ACCESS', refresh_token: 'PRIVATE_REFRESH', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    if (url.endsWith('/profile')) return Response.json({ emailAddress: criteria.email });
    if (url.includes('/messages?')) return Response.json({ messages: [{ id: 'one' }] });
    if (url.includes('/messages/one')) return Response.json(message());
    return Response.json({});
  } });
  gmail.configure(credentials); return { gmail, calls };
}
async function connect(gmail) {
  const url = new URL(gmail.connect().url);
  await gmail.callback(new URLSearchParams({ state: url.searchParams.get('state'), code: 'AUTH_CODE' }));
  return url;
}
test('OAuth uses expiring one-use state, PKCE and read-only scope; status exposes no tokens', async () => {
  const { gmail, calls } = connection();
  const url = new URL(gmail.connect().url);
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
  await assert.rejects(gmail.callback(new URLSearchParams({ state: 'wrong', code: 'anything' })), /invalid/);
  assert.equal(calls.length, 0);
  const params = new URLSearchParams({ state: url.searchParams.get('state'), code: 'AUTH_CODE' });
  await gmail.callback(params);
  const verifier = calls[0].options.body.get('code_verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(gmail.status().connected, true);
  assert.ok(!JSON.stringify(gmail.status()).includes('PRIVATE'));
  await assert.rejects(gmail.callback(params), /invalid/);
  assert.equal(await gmail.findCode(criteria), '654321');
  assert.equal(await gmail.findCode(criteria), null, 'never reuse a consumed email');
  assert.ok(calls.find(c => c.url.includes('/messages?')).url.includes('after'));
  const before = calls.length;
  await assert.rejects(gmail.findCode({ ...criteria, email: 'wrong@example.test' }), /matches/);
  assert.equal(calls.length, before, 'account mismatch must not read mail');
  await gmail.disconnect();
  assert.equal(gmail.status().connected, false); assert.equal(gmail.tokens, null);
  assert.ok(calls.some(c => c.url.endsWith('/revoke')));
});
test('expired/denied OAuth and provider errors are safe and never expose secrets', async () => {
  const { gmail } = connection();
  const url = new URL(gmail.connect().url); gmail.pending.expires = 0;
  await assert.rejects(gmail.callback(new URLSearchParams({ state: url.searchParams.get('state'), code: 'SECRET' })), /expired/);
  const denied = new URL(gmail.connect().url);
  await assert.rejects(gmail.callback(new URLSearchParams({ state: denied.searchParams.get('state'), error: 'access_denied' })), /not granted/);
  await connect(gmail);
  gmail.fetcher = async () => { throw new Error('SECRET raw provider failure'); };
  await assert.rejects(gmail.findCode(criteria), error => !error.message.includes('SECRET') && /Gmail/.test(error.message));
  const result = await gmail.disconnect(); assert.equal(result.connected, false); assert.match(result.message, /Google could not be reached/);
});
