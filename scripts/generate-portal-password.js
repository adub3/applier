// Generates and saves a portal password without printing or persisting plaintext.
import { randomInt } from 'node:crypto';
import { load } from 'cheerio';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
const chars = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%'].map(pool => pool[randomInt(pool.length)]);
while (chars.length < 24) chars.push(alphabet[randomInt(alphabet.length)]);
for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
try {
  const origin = 'http://127.0.0.1:4317';
  const token = load(await (await fetch(origin)).text())('meta[name="app-token"]').attr('content');
  const headers = { 'Content-Type': 'application/json', 'x-app-token': token };
  const profile = await (await fetch(origin + '/api/profile', { headers })).json();
  const response = await fetch(origin + '/api/portal-account', { method: 'POST', headers, body: JSON.stringify({ email: profile.email, password: chars.join(''), enabled: true }) });
  if (!response.ok) throw new Error('save failed');
  const status = await response.json();
  if (!status.hasPassword) throw new Error('save unconfirmed');
  console.log('A 24-character password with uppercase, lowercase, digits, and symbols was saved securely.');
} catch { console.error('The generated password could not be saved.'); process.exitCode = 1; }
finally { chars.fill(''); }
