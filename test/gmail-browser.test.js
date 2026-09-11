import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { GmailBrowser, codeFromOriginal } from '../src/gmail-browser.js';

const criteria = { email: 'alternate@example.test', since: Date.now() - 60000, company: 'Fixture Company', title: 'Analyst' };
const raw = `From: Greenhouse <no-reply@us.greenhouse-mail.io>\r\nTo: alternate@example.test\r\nDate: ${new Date().toUTCString()}\r\nSubject: Fixture Company verification\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@us.greenhouse-mail.io;\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour verification code: 654321\r\n`;
test('raw Gmail message decoding preserves strict sender, recipient and code checks', async () => {
  assert.equal(await codeFromOriginal(raw, criteria), '654321');
  assert.equal(await codeFromOriginal(raw.replace('dkim=pass', 'dkim=fail'), criteria), null);
  assert.equal(await codeFromOriginal(raw, { ...criteria, email: 'other@example.test' }), null);
});
test('browser sign-in detects account, reads original email once, and disconnects without storing cookies', async () => {
  const gmail = new GmailBrowser(async () => {
    const browser = await chromium.launch({ headless: true });
    const originalNewContext = browser.newContext.bind(browser);
    browser.newContext = async () => {
      const context = await originalNewContext();
      await context.route('**/*', route => {
        if (route.request().url().includes('view=om')) return route.fulfill({ contentType: 'text/html', body: '<pre>' + raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</pre>' });
        return route.fulfill({ contentType: 'text/html', body: `<a aria-label="Google Account: Fixture (alternate@example.test)">Account</a><input name="q"><div role="main"><table><tr class="zA"><td>Verification</td></tr></table><div class="adn"><button aria-label="More">More</button></div><button role="menuitem">Show original</button></div><script>document.querySelector('[role=menuitem]').onclick=()=>window.open('/mail/u/0/?view=om','_blank')</script>` });
      });
      return context;
    };
    return browser;
  });
  try {
    assert.equal(gmail.status().connected, false);
    assert.equal((await gmail.connect()).email, criteria.email);
    assert.equal(await gmail.findCode(criteria), '654321');
    assert.equal(await gmail.findCode(criteria), null);
    assert.ok(!JSON.stringify(gmail.status()).includes('654321'));
    await assert.rejects(gmail.findCode({ ...criteria, email: 'wrong@example.test' }), /same email/);
    await gmail.page.goto('https://accounts.google.com/');
    assert.equal((await gmail.refresh()).connected, false);
    const status = await gmail.disconnect();
    assert.equal(status.browserOpen, false); assert.equal(status.connected, false);
  } finally { await gmail.disconnect(); }
});
