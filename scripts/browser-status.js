import { load } from 'cheerio';
const origin = 'http://127.0.0.1:4317';
const html = await (await fetch(origin)).text();
const token = load(html)('meta[name="app-token"]').attr('content');
const state = await (await fetch(origin + '/api/application-browser', { headers: { 'x-app-token': token } })).json();
console.log(JSON.stringify({ state: state?.state, message: state?.message }));
