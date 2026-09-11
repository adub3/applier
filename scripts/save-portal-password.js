// Read the supplied password from stdin, never argv, files, stdout, or logs.
import { load } from 'cheerio';
const origin = 'http://127.0.0.1:4317';
const token = load(await (await fetch(origin)).text())('meta[name="app-token"]').attr('content');
const headers = { 'Content-Type': 'application/json', 'x-app-token': token };
const profile = await (await fetch(origin + '/api/profile', { headers })).json();
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.once('data', async bytes => {
  try {
    const response = await fetch(origin + '/api/portal-account', { method: 'POST', headers, body: JSON.stringify({ email: profile.email, password: bytes.toString().trim(), enabled: true }) });
    console.log(response.ok ? 'Portal credentials saved securely.' : 'Portal credentials could not be saved.');
    process.exitCode = response.ok ? 0 : 1;
  } catch { console.log('Portal credentials could not be saved.'); process.exitCode = 1; }
  finally { process.stdin.destroy(); }
});
