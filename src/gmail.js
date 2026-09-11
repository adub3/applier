import { randomBytes, createHash } from 'node:crypto';
import { load } from 'cheerio';
import { UserFacingError } from './errors.js';

const scope = 'https://www.googleapis.com/auth/gmail.readonly';
const api = 'https://gmail.googleapis.com/gmail/v1/users/me';
const trustedDomain = domain => /(^|\.)(greenhouse\.io|greenhouse-mail\.io)$/i.test(domain);
const addresses = value => String(value || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];

// Email is untrusted data, never model instructions. Only extract an unambiguous numeric code.
export function verificationCode(message, { email, since, company, title }) {
  if (!Number.isFinite(since) || Number(message.internalDate) < since || Number(message.internalDate) > Date.now() + 60000) return null;
  const headers = message.payload?.headers || [];
  const header = name => headers.filter(h => h.name.toLowerCase() === name).map(h => h.value).join('\n');
  const from = addresses(header('from'));
  if (from.length !== 1 || !trustedDomain(from[0].split('@')[1])) return null;
  if (!addresses(header('to')).includes(email.toLowerCase())) return null;
  const auth = headers.find(h => h.name.toLowerCase() === 'authentication-results')?.value || '';
  if (!/^mx\.google\.com;/i.test(auth.trim()) || !auth.split(';').some(result => /\bdkim=pass\b/i.test(result) && /header\.(?:d|i)=(?:[^\s;@]*@)?(?:[a-z0-9-]+\.)*(?:greenhouse\.io|greenhouse-mail\.io)(?=[;\s]|$)/i.test(result))) return null;
  function body(part) {
    if (part.filename) return '';
    const value = part.body?.data && /^text\/(plain|html)$/.test(part.mimeType) ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '';
    return (part.mimeType === 'text/html' ? load(value).text() : value) + '\n' + (part.parts || []).map(body).join('\n');
  }
  const text = header('subject') + '\n' + body(message.payload || {});
  // Require the employer or role to be named; generic account-login codes need manual review.
  if (![company, title].filter(x => x && x.length >= 3).some(x => text.toLowerCase().includes(x.toLowerCase()))) return null;
  const matches = [...text.matchAll(/(?:verification|security|one[- ]time|confirmation)\s+code\s*(?:is|:|-)?\s*(\d{4,8})\b/gi)].map(m => m[1]);
  const codes = [...new Set(matches)];
  return codes.length === 1 ? codes[0] : null;
}

export class GmailConnection {
  constructor({ client = null, redirectUri, fetcher = fetch } = {}) {
    this.client = client; this.redirectUri = redirectUri; this.fetcher = fetcher;
    this.tokens = null; this.email = null; this.pending = null; this.used = new Set(); this.generation = 0;
  }
  configure(document) {
    const c = document?.installed;
    if (!c || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(c.client_id || '') || typeof c.client_secret !== 'string' || c.client_secret.length > 500) throw new UserFacingError('Choose the Google OAuth JSON downloaded for a Desktop app.');
    if (this.tokens) throw new UserFacingError('Disconnect Gmail before replacing its setup.');
    this.pending = null; this.client = { client_id: c.client_id, client_secret: c.client_secret }; return this.client;
  }
  status() { return { configured: !!this.client, connected: !!this.tokens, email: this.email, sessionOnly: true }; }
  connect() {
    if (!this.client) throw new UserFacingError('Upload your Google Desktop app OAuth JSON in Email verification setup first.');
    if (this.tokens) throw new UserFacingError('Disconnect the current Gmail account before connecting another.');
    this.generation++;
    const verifier = randomBytes(48).toString('base64url');
    this.pending = { state: randomBytes(32).toString('hex'), verifier, expires: Date.now() + 600000 };
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.client.client_id, redirect_uri: this.redirectUri, response_type: 'code', scope, state: this.pending.state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' });
    return { url: url.href };
  }
  async request(url, options = {}) {
    try {
      const response = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('Provider request rejected');
      return await response.json();
    } catch { throw new UserFacingError('Gmail could not complete the request. Check your connection and Google setup, or reconnect Gmail.'); }
  }
  async tokenRequest(values) {
    return this.request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...this.client, ...values }) });
  }
  async callback(params) {
    const pending = this.pending;
    if (!pending || pending.expires < Date.now() || params.get('state') !== pending.state) throw new UserFacingError('This Gmail connection link expired or is invalid. Start Connect Gmail again.');
    this.pending = null;
    if (params.has('error') || !params.get('code')) throw new UserFacingError('Gmail access was not granted. You can connect again or enter verification codes manually.');
    const generation = this.generation;
    const tokens = await this.tokenRequest({ code: params.get('code'), code_verifier: pending.verifier, redirect_uri: this.redirectUri, grant_type: 'authorization_code' });
    if (!tokens.access_token || !tokens.scope?.split(' ').includes(scope)) throw new UserFacingError('Gmail read access was not granted. Connect again and approve read-only access.');
    const profile = await this.request(api + '/profile', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
    if (!profile.emailAddress || generation !== this.generation) throw new UserFacingError('Gmail connection was cancelled.');
    this.tokens = { ...tokens, expires: Date.now() + Number(tokens.expires_in || 3600) * 1000 }; this.email = profile.emailAddress;
    return this.status();
  }
  async access() {
    if (!this.tokens) throw new UserFacingError('Connect Gmail first.');
    if (this.tokens.expires < Date.now() + 60000) {
      const generation = this.generation;
      const refreshed = await this.tokenRequest({ refresh_token: this.tokens.refresh_token, grant_type: 'refresh_token' });
      if (generation !== this.generation || !this.tokens) throw new UserFacingError('Gmail was disconnected.');
      if (!refreshed.access_token) throw new UserFacingError('Reconnect Gmail to continue email verification.');
      this.tokens = { ...this.tokens, ...refreshed, expires: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
    }
    return this.tokens.access_token;
  }
  async findCode(criteria) {
    if (!this.email || this.email.toLowerCase() !== criteria.email.toLowerCase()) throw new UserFacingError('Connect the Gmail account that matches this application’s email.');
    if (!Number.isFinite(criteria.since) || Date.now() - criteria.since > 15 * 60000) throw new UserFacingError('Automatic email checking has expired. Enter the latest code manually.');
    const generation = this.generation;
    const headers = { Authorization: 'Bearer ' + await this.access() };
    const q = `after:${Math.floor(criteria.since / 1000)} {from:greenhouse.io from:greenhouse-mail.io} {verification security confirmation}`;
    const list = await this.request(api + '/messages?' + new URLSearchParams({ q, maxResults: '10' }), { headers });
    if (list.nextPageToken) throw new UserFacingError('Several verification emails matched. Enter the correct code manually.');
    const found = [];
    for (const item of list.messages || []) {
      if (generation !== this.generation) throw new UserFacingError('Gmail was disconnected.');
      if (this.used.has(item.id)) continue;
      const message = await this.request(api + '/messages/' + encodeURIComponent(item.id) + '?format=full', { headers });
      const code = verificationCode(message, criteria);
      if (code) found.push({ id: item.id, code });
    }
    if (generation !== this.generation) throw new UserFacingError('Gmail was disconnected.');
    if (found.length > 1) throw new UserFacingError('Several verification emails matched. Enter the correct code manually.');
    if (found.length === 1) { this.used.add(found[0].id); return found[0].code; }
    return null;
  }
  async disconnect() {
    const token = this.tokens?.refresh_token || this.tokens?.access_token;
    this.generation++; this.tokens = null; this.email = null; this.pending = null; this.used.clear();
    let revoked = !token;
    if (token) try {
      const r = await this.fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000), redirect: 'error' }); revoked = r.ok;
    } catch { /* Local access is removed even if Google is unreachable. */ }
    return { ...this.status(), message: revoked ? 'Gmail disconnected.' : 'Local Gmail access removed. Google could not be reached; remove the app from your Google account permissions too.' };
  }
}
