import { chromium } from 'playwright';
import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import { verificationCode } from './gmail.js';
import { UserFacingError } from './errors.js';

export async function codeFromOriginal(raw, criteria) {
  if (!raw || raw.length > 2 * 1024 * 1024) return null;
  const mail = await simpleParser(raw, { skipHtmlToText: false, skipImageLinks: true });
  return verificationCode({ internalDate: mail.date?.getTime(), payload: {
    headers: mail.headerLines.map(h => ({ name: h.key, value: h.line.slice(h.line.indexOf(':') + 1).replace(/\r?\n\s+/g, ' ').trim() })),
    mimeType: 'text/plain', body: { data: Buffer.from(mail.text || '').toString('base64url') }
  } }, criteria);
}

export class GmailBrowser {
  constructor(launch = async () => {
    try { return await chromium.launch({ channel: 'chrome', headless: false }); }
    catch (error) { if (!/executable|distribution.*not found/i.test(error.message)) throw error; return chromium.launch({ headless: false }); }
  }) { this.launch = launch; this.browser = null; this.page = null; this.email = null; this.busy = false; this.generation = 0; this.used = new Set(); }
  status() { return { configured: true, connected: !!this.email, email: this.email, browserOpen: !!this.browser, method: 'browser', message: this.message || null }; }
  async connect() {
    if (this.busy) throw new UserFacingError('Gmail is busy. Wait for the current check.');
    if (this.page && !this.page.isClosed()) { await this.page.bringToFront(); return this.refresh(); }
    this.busy = true;
    try {
      this.browser = await this.launch();
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(5000);
      this.browser.on('disconnected', () => { this.browser = null; this.page = null; this.email = null; this.generation++; });
      await this.page.goto('https://mail.google.com/mail/u/0/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      this.message = 'Sign in to your alternate Gmail account in the browser window. Complete any Google security checks yourself.';
      return await this.refresh();
    } catch {
      await this.browser?.close().catch(() => {}); this.browser = null; this.page = null;
      throw new UserFacingError('The Gmail browser could not open. Check your connection and Chrome installation, then try Sign in to Gmail again.');
    } finally { this.busy = false; }
  }
  async refresh() {
    this.email = null;
    if (!this.page || this.page.isClosed()) return this.status();
    try {
      if (new URL(this.page.url()).origin !== 'https://mail.google.com') return this.status();
      const identities = await this.page.locator('[aria-label*="Google Account"],[aria-label*="Google account"],[title*="Google Account"]').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label') || el.getAttribute('title')));
      const emails = [...new Set(identities.flatMap(label => label.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/gi) || []))];
      if (emails.length === 1 && await this.page.locator('input[name="q"],input[placeholder="Search mail"]').count()) {
        this.email = emails[0]; this.message = 'Signed in. The bot can check matching verification emails when an application needs a code.';
      }
    } catch { /* Sign-in navigation can temporarily replace the page. */ }
    return this.status();
  }
  async findCode(criteria) {
    if (this.busy) throw new UserFacingError('The Gmail browser is busy. Try Check Gmail again shortly.');
    await this.refresh();
    if (!this.email || this.email.toLowerCase() !== criteria.email.toLowerCase()) throw new UserFacingError('Sign in to Gmail with the same email address used for this application.');
    if (!Number.isFinite(criteria.since) || Date.now() - criteria.since > 15 * 60000) throw new UserFacingError('Automatic email checking has expired. Enter the latest code manually.');
    this.busy = true;
    const generation = this.generation;
    let reader, original;
    try {
      const account = new URL(this.page.url()).pathname.match(/^\/mail\/u\/\d+\//)?.[0];
      if (!account) throw new Error('Account not recognized');
      reader = await this.context.newPage(); reader.setDefaultTimeout(5000);
      const q = `after:${Math.floor(criteria.since / 1000)} to:(${criteria.email}) {from:greenhouse.io from:greenhouse-mail.io} {verification security confirmation}`;
      await reader.goto(`https://mail.google.com${account}#search/${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
      await reader.locator('[role="main"]').waitFor();
      const rows = reader.locator('tr.zA');
      await reader.waitForFunction(() => document.querySelector('tr.zA') || /No conversations found|No results found/i.test(document.querySelector('[role="main"]')?.textContent || ''), null, { timeout: 10000 });
      if (!await rows.count()) return null;
      if (await rows.count() !== 1) throw new UserFacingError('More than one verification email matched. Enter the correct code manually.');
      await rows.first().click();
      const more = reader.locator('.adn').getByRole('button', { name: 'More', exact: true });
      await more.first().waitFor({ state: 'visible' });
      if (await more.count() !== 1) throw new UserFacingError('Gmail’s message controls are unclear. Enter this verification code manually.');
      await more.click();
      const show = reader.getByRole('menuitem', { name: 'Show original', exact: true });
      await show.first().waitFor({ state: 'visible' });
      if (await show.count() !== 1) throw new UserFacingError('Gmail’s message details could not be opened. Enter the code manually.');
      [original] = await Promise.all([reader.waitForEvent('popup', { timeout: 5000 }), show.click()]);
      await original.waitForLoadState('domcontentloaded');
      if (new URL(original.url()).origin !== 'https://mail.google.com') throw new Error('Unexpected original-message origin');
      const source = original.locator('pre');
      if (await source.count() !== 1) throw new Error('Original email format not recognized');
      const raw = await source.textContent();
      const id = createHash('sha256').update(raw || '').digest('hex');
      if (this.used.has(id)) return null;
      const code = await codeFromOriginal(raw, criteria);
      if (generation !== this.generation || !this.browser) throw new UserFacingError('Gmail was disconnected.');
      if (code) this.used.add(id);
      return code;
    } catch (error) {
      throw error instanceof UserFacingError ? error : new UserFacingError('Gmail could not be read reliably. Check the Gmail window, or enter the verification code manually.');
    } finally {
      await original?.close().catch(() => {}); await reader?.close().catch(() => {}); this.busy = false;
    }
  }
  async disconnect() {
    this.generation++; this.email = null; this.used.clear();
    const browser = this.browser; this.browser = null; this.page = null;
    await browser?.close();
    this.message = 'Gmail disconnected. The temporary browser session and its cookies have been closed.';
    return this.status();
  }
}
