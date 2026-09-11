import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA } from './config.js';
import { hash, employerSalary } from './domain.js';

function withDescriptionPay(job) {
  return { ...job, ...(employerSalary(job.description) ?? {}) };
}

export function openStore(location = path.join(DATA, 'catalog.sqlite')) {
  if (location !== ':memory:') fs.mkdirSync(path.dirname(location), { recursive: true });
  const db = new DatabaseSync(location);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, canonical TEXT UNIQUE NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL, content_hash TEXT NOT NULL, data TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(id UNINDEXED, title, company, description);
    CREATE TABLE IF NOT EXISTS vectors(job_id TEXT NOT NULL, content_hash TEXT NOT NULL, model_key TEXT NOT NULL, chunk INTEGER NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(job_id, model_key, chunk));
    CREATE TABLE IF NOT EXISTS reviews(job_id TEXT NOT NULL, cache_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(job_id, cache_key));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS queue(job_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS application_drafts(job_id TEXT PRIMARY KEY, state TEXT NOT NULL, notes TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS application_questions(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reusable_answers(question_key TEXT PRIMARY KEY, prompt TEXT NOT NULL, answer TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
  `);
  return {
    db,
    get(key, fallback = null) { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
    set(key, value) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    allJobs() { return db.prepare('SELECT data FROM jobs').all().map(row => withDescriptionPay(JSON.parse(row.data))); },
    job(id) { const row = db.prepare('SELECT data FROM jobs WHERE id=?').get(id); return row ? withDescriptionPay(JSON.parse(row.data)) : null; },
    upsert(job) {
      const contentHash = hash([job.title, job.company, job.location, job.description, job.status].join('\n'));
      const value = { ...job, contentHash };
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical=excluded.canonical,title=excluded.title,company=excluded.company,content_hash=excluded.content_hash,data=excluded.data').run(job.id, job.canonical, job.title, job.company, contentHash, JSON.stringify(value));
        db.prepare('DELETE FROM jobs_fts WHERE id=?').run(job.id);
        db.prepare('INSERT INTO jobs_fts VALUES (?,?,?,?)').run(job.id, job.title, job.company, job.description ?? '');
        db.prepare('DELETE FROM vectors WHERE job_id=? AND content_hash<>?').run(job.id, contentHash);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return value;
    },
    lexical(query) {
      const terms = [...new Set(query.toLowerCase().match(/[a-z][a-z0-9+]{1,25}/g) ?? [])].slice(0, 30);
      if (!terms.length) return [];
      return db.prepare('SELECT id,bm25(jobs_fts,0,5,1,1) AS score FROM jobs_fts WHERE jobs_fts MATCH ? ORDER BY score LIMIT 3000').all(terms.map(term => `"${term}"`).join(' OR '));
    },
    vectorRows(modelKey) { return db.prepare('SELECT * FROM vectors WHERE model_key=?').all(modelKey); },
    vectors(job, modelKey, values) {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM vectors WHERE job_id=? AND model_key=?').run(job.id, modelKey);
        const insert = db.prepare('INSERT INTO vectors VALUES (?,?,?,?,?,?)');
        values.forEach((vector, i) => insert.run(job.id, job.contentHash, modelKey, i, vector.length, Buffer.from(new Float32Array(vector).buffer)));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    readReview(id, key) { const row = db.prepare('SELECT data FROM reviews WHERE job_id=? AND cache_key=?').get(id, key); return row ? JSON.parse(row.data) : null; },
    writeReview(id, key, data) { db.prepare('INSERT OR REPLACE INTO reviews VALUES (?,?,?)').run(id, key, JSON.stringify(data)); },
    applicationDraft(jobId) { return db.prepare('SELECT * FROM application_drafts WHERE job_id=?').get(jobId) ?? null; },
    applicationDrafts() { return db.prepare('SELECT * FROM application_drafts ORDER BY updated_at DESC').all(); },
    saveApplicationDraft(jobId, state, notes) {
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO application_drafts VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,notes=excluded.notes,updated_at=excluded.updated_at').run(jobId, state, notes, updatedAt);
      return this.applicationDraft(jobId);
    },
    applicationQuestions(jobId = null) {
      return jobId ? db.prepare('SELECT * FROM application_questions WHERE job_id=? ORDER BY state,updated_at DESC').all(jobId) : db.prepare('SELECT * FROM application_questions ORDER BY state,updated_at DESC').all();
    },
    saveApplicationQuestion({ id, jobId, prompt, answer, state }) {
      const now = new Date().toISOString();
      if (id) {
        db.prepare('UPDATE application_questions SET prompt=?,answer=?,state=?,updated_at=? WHERE id=?').run(prompt, answer, state, now, id);
        this.writeAnswerNotes();
        return db.prepare('SELECT * FROM application_questions WHERE id=?').get(id);
      }
      const result = db.prepare('INSERT INTO application_questions(job_id,prompt,answer,state,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(jobId, prompt, answer, state, now, now);
      this.writeAnswerNotes();
      return db.prepare('SELECT * FROM application_questions WHERE id=?').get(result.lastInsertRowid);
    },
    reusableAnswers() { return db.prepare('SELECT * FROM reusable_answers ORDER BY updated_at DESC').all(); },
    writeAnswerNotes() {
      if (location === ':memory:') return;
      const sections = ['# Saved application answers', '', 'Maintained by Job Desk. Edit answers in the app. Employer-specific answers stay scoped to their application; reusable answers are listed separately.', '', '## Reusable answers', ''];
      for (const a of this.reusableAnswers()) sections.push(`### ${a.prompt.replace(/\s+/g, ' ')}`, '', a.answer, '');
      sections.push('## Application answers', '');
      for (const a of this.applicationQuestions().filter(q => q.state === 'answered' && q.answer)) {
        const job = this.job(a.job_id);
        sections.push(`### ${job?.company || 'Application'} — ${a.prompt.replace(/\s+/g, ' ')}`, '', `Application: ${a.job_id}`, '', a.answer, '');
      }
      fs.writeFileSync(path.join(path.dirname(location), 'application-answers.md'), sections.join('\n'));
    },
    saveReusableAnswer(questionKey, prompt, answer) {
      const updatedAt = new Date().toISOString();
      db.prepare('INSERT INTO reusable_answers VALUES (?,?,?,?) ON CONFLICT(question_key) DO UPDATE SET prompt=excluded.prompt,answer=excluded.answer,updated_at=excluded.updated_at').run(questionKey, prompt, answer, updatedAt);
      this.writeAnswerNotes();
      return db.prepare('SELECT * FROM reusable_answers WHERE question_key=?').get(questionKey);
    },
    event(kind, data) { db.prepare('INSERT INTO events(created_at,kind,data) VALUES (?,?,?)').run(new Date().toISOString(), kind, JSON.stringify(data)); },
    close() { db.close(); }
  };
}
