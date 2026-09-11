import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { DATA } from './config.js';
import { UserFacingError } from './errors.js';
import { clean, hash, skillsIn } from './domain.js';

export function saveProfile(store, input) {
  const text = String(input.text ?? '').trim();
  if (text.length < 40 || text.length > 60000) throw new UserFacingError('Profile text must contain 40–60,000 characters.');
  const previous = store.get('profile', {});
  const profile = { ...previous, text, hash: hash(text), name: clean(input.name ?? previous.name), email: clean(input.email ?? previous.email), phone: clean(input.phone ?? previous.phone), linkedin: clean(input.linkedin ?? previous.linkedin), resumePath: input.resumePath ?? previous.resumePath ?? null, sourceName: input.sourceName ?? previous.sourceName ?? 'Entered profile', approved: input.approved === true, skills: skillsIn(text), updatedAt: new Date().toISOString() };
  for (const key of ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode']) profile[key] = clean(input[key] ?? previous[key] ?? '');
  store.set('profile', profile);
  return profile;
}
export async function importResume(store, inputPath) {
  const absolute = path.resolve(inputPath);
  const buffer = await fs.readFile(absolute);
  if (buffer.length > 10 * 1024 * 1024) throw new UserFacingError('Resume is too large (10 MB maximum).');
  let text;
  if (path.extname(absolute).toLowerCase() === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  } else if (path.extname(absolute).toLowerCase() === '.txt') text = buffer.toString('utf8');
  else throw new UserFacingError('Use a PDF or plain-text resume.');
  await fs.mkdir(DATA, { recursive: true });
  const savedPath = path.join(DATA, `resume-${hash(buffer).slice(0, 16)}${path.extname(absolute).toLowerCase()}`);
  await fs.copyFile(absolute, savedPath);
  const email = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? '';
  const firstLine = text.split('\n').find(line => line.trim()) ?? '';
  const profile = saveProfile(store, { text, name: firstLine.length < 80 ? clean(firstLine) : '', email, sourceName: path.basename(absolute), resumePath: savedPath, approved: false });
  return { sourceName: profile.sourceName, characters: text.length, skills: profile.skills, approved: false };
}
