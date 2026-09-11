import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.JOB_BOT_DATA ? path.resolve(process.env.JOB_BOT_DATA) : path.join(ROOT, '.local');
export const REPOSITORY = path.join(ROOT, 'sources', 'speedyapply-ai');
export const SOURCE_URL = 'https://github.com/speedyapply/2027-AI-College-Jobs';
export const OLLAMA = 'http://127.0.0.1:11434';
export const EMBED_MODEL = 'nomic-embed-text:latest';
export const REVIEW_MODEL = 'deepseek-r1:8b';
