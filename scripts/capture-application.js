import { load } from 'cheerio';
import fs from 'node:fs/promises';
const origin = 'http://127.0.0.1:4317';
const html = await (await fetch(origin)).text();
const token = load(html)('meta[name="app-token"]').attr('content');
const preview = await (await fetch(origin + '/api/application-browser/preview', { headers: { 'x-app-token': token } })).json();
if (preview.image) { await fs.writeFile('.local/application-live-preview.jpg', Buffer.from(preview.image.split(',')[1], 'base64')); console.log('Saved .local/application-live-preview.jpg'); }
else console.log('No browser preview available');
