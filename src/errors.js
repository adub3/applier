import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA } from './config.js';

export class UserFacingError extends Error {}

export function logError(error, operation = 'app') {
  const reference = randomUUID();
  const entry = { at: new Date().toISOString(), reference, operation, name: error?.name, message: String(error?.message ?? error), stack: error?.stack };
  // Do not include request bodies, uploaded files, answers, or credentials.
  const serialized = JSON.stringify(entry).replace(/(Bearer\s+)[\w.\-]+/gi, '$1[redacted]').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
  try {
    const directory = path.join(DATA, 'logs'); fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, `errors-${entry.at.slice(0, 10)}.jsonl`), serialized + '\n');
  } catch { console.error('[Error log unavailable]', reference, operation); }
  return reference;
}

export function publicError(error, operation = 'app', fallback = 'Something went wrong. Please try again. If it continues, restart the app.') {
  const reference = logError(error, operation);
  return { error: error instanceof UserFacingError ? error.message : friendlyFailure(error?.message, fallback), reference };
}

export function friendlyFailure(message, fallback = 'The operation could not finish. Please try again.') {
  if (/ERR_NETWORK_ACCESS_DENIED|ERR_BLOCKED_BY_ADMINISTRATOR/i.test(message || '')) return 'The application browser was blocked from opening the employer’s website. Check the browser’s network permissions, then close this session and try again.';
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|fetch failed/i.test(message || '')) return 'The website could not be reached. Check your internet connection and try again.';
  if (/Timeout|timed out/i.test(message || '')) return 'The website took too long to respond. Check the browser window, then try again.';
  if (/Target.*closed|page.*closed|context.*closed/i.test(message || '')) return 'The application browser was closed. Start a new browser session to continue.';
  return fallback;
}

// Also protect historical diagnostic strings already stored in the database.
export function publicData(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(publicData);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (item && ['detailError', 'semanticError', 'error'].includes(key)) return [key, key === 'detailError' ? 'The employer page could not be checked. You can open it directly.' : 'This service is temporarily unavailable. Please try again.'];
    if (key === 'message' && value.state === 'failed') return [key, 'This operation could not finish. Please try again.'];
    if (key === 'message' && value.state === 'paused' && !value.userFacing) return [key, friendlyFailure(item, 'The application is paused. Check the browser window, then try Resume.')];
    return [key, publicData(item)];
  }));
}
