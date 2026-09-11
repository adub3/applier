import { spawn } from 'node:child_process';
import { UserFacingError } from './errors.js';

// DPAPI CurrentUser binds this secret to the Windows user running the local app.
async function protect(value, decrypt = false) {
  if (process.platform !== 'win32') throw new UserFacingError('Protected portal passwords currently require Windows.');
  const script = `Add-Type -AssemblyName System.Security; $payload=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($payload); $result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    const fail = () => reject(new UserFacingError('Windows could not unlock the portal password. Save it again in Profile.'));
    child.on('error', fail);
    child.on('close', code => code === 0 ? resolve(output.trim()) : fail());
    child.stdin.on('error', fail);
    child.stdin.end(decrypt ? value : Buffer.from(value).toString('base64'));
  });
}
export function portalAccountStatus(store) {
  const item = store.get('portalAccount');
  return { email: item?.email || store.get('profile')?.email || '', enabled: !!item?.enabled, hasPassword: !!item?.cipher };
}
export async function savePortalAccount(store, input) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email || '')) throw new UserFacingError('Enter your portal account email.');
  if (input.password != null && (typeof input.password !== 'string' || input.password.length > 256)) throw new UserFacingError('Enter a valid portal password.');
  const old = store.get('portalAccount');
  const cipher = input.password ? await protect(input.password) : old?.email === input.email ? old.cipher : null;
  if (input.enabled && !cipher) throw new UserFacingError('Save a portal password before enabling account automation.');
  store.set('portalAccount', { email: input.email, enabled: input.enabled === true, cipher });
  return portalAccountStatus(store);
}
export async function portalCredentials(store, email) {
  const item = store.get('portalAccount');
  if (!item?.enabled || item.email !== email || !item.cipher) return null;
  return { email, password: Buffer.from(await protect(item.cipher, true), 'base64').toString('utf8') };
}
