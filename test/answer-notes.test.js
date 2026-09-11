import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/db.js';

test('answered inbox items persist to Markdown, retain scope, and update without duplicates', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'job-answer-notes-'));
  const store = openStore(path.join(directory, 'catalog.sqlite'));
  try {
    const question = store.saveApplicationQuestion({ jobId: 'employer-one', prompt: 'Previously employed here?', answer: '', state: 'needs_answer' });
    const file = path.join(directory, 'application-answers.md');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(question.prompt));
    store.saveApplicationQuestion({ ...question, jobId: 'employer-one', answer: 'No', state: 'answered' });
    assert.equal(store.applicationQuestions().filter(q => q.state === 'needs_answer').length, 0);
    assert.match(fs.readFileSync(file, 'utf8'), /Application: employer-one\n\nNo/);
    assert.equal(store.reusableAnswers().length, 0);
    store.saveApplicationQuestion({ ...question, jobId: 'employer-one', answer: 'Yes', state: 'answered' });
    const notes = fs.readFileSync(file, 'utf8');
    assert.equal(notes.split(question.prompt).length - 1, 1);
    assert.match(notes, /Application: employer-one\n\nYes/);
    store.saveReusableAnswer('city', 'City', 'Chapel Hill');
    assert.match(fs.readFileSync(file, 'utf8'), /## Reusable answers\n\n### City\n\nChapel Hill/);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
