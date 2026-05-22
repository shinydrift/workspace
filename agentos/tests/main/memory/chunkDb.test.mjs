/**
 * Tests for memory/chunkDb.ts — chunk CRUD operations (inlined).
 * Uses node:sqlite (built-in) for an in-memory DB.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// ── Schema (minimal subset needed for chunkDb operations) ─────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, id UNINDEXED, path UNINDEXED, source UNINDEXED,
  model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED
);
`;

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Inlined from chunkDb.ts (adapted: transactions replaced with direct calls) ─

function deleteChunk(db, chunkId) {
  db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunkId);
  db.prepare('DELETE FROM chunks WHERE id = ?').run(chunkId);
}

function deleteFile(db, filePath) {
  db.prepare('DELETE FROM chunks_fts WHERE path = ?').run(filePath);
  db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath);
  db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
}

function updateChunk(db, chunkId, text) {
  db.prepare('UPDATE chunks SET text = ?, user_edited = 1 WHERE id = ?').run(text, chunkId);
  db.prepare('UPDATE chunks_fts SET text = ? WHERE id = ?').run(text, chunkId);
}

function pinChunk(db, chunkId, pinned) {
  db.prepare('UPDATE chunks SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, chunkId);
}

function listChunks(db, params) {
  const filterSource = params.source && params.source !== 'all' ? params.source : null;
  const total = filterSource
    ? db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE source = ?').get(filterSource).n
    : db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  const offset = params.page * params.pageSize;
  const selectSql =
    'SELECT id, path, source, start_line, end_line, model, text, updated_at, pinned, user_edited FROM chunks';
  const rows = filterSource
    ? db.prepare(`${selectSql} WHERE source = ? ORDER BY path, start_line LIMIT ? OFFSET ?`).all(filterSource, params.pageSize, offset)
    : db.prepare(`${selectSql} ORDER BY path, start_line LIMIT ? OFFSET ?`).all(params.pageSize, offset);
  const chunks = rows.map((r) => ({
    id: r.id,
    path: r.path,
    source: r.source,
    startLine: r.start_line,
    endLine: r.end_line,
    model: r.model,
    text: r.text,
    updatedAt: r.updated_at,
    pinned: r.pinned === 1,
    userEdited: r.user_edited === 1,
  }));
  return { chunks, total };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function insertChunk(db, { id, path = 'test.md', source = 'memory', text = 'hello', pinned = 0, userEdited = 0 }) {
  db.prepare(
    `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, updated_at, pinned, user_edited)
     VALUES (?, ?, ?, 1, 5, 'h', 'local', ?, ?, ?, ?)`
  ).run(id, path, source, text, Date.now(), pinned, userEdited);
  db.prepare(`INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line) VALUES (?, ?, ?, ?, ?, 1, 5)`)
    .run(text, id, path, source, 'local');
}

function insertFile(db, filePath) {
  db.prepare(`INSERT INTO files (path, source, hash, mtime, size) VALUES (?, 'memory', 'h', 0, 0)`).run(filePath);
}

function withDb(fn) {
  const db = openDb();
  try { fn(db); } finally { db.close(); }
}

// ── deleteChunk ───────────────────────────────────────────────────────────────

test('deleteChunk: removes chunk from chunks table', () => withDb((db) => {
  insertChunk(db, { id: 'c1' });
  deleteChunk(db, 'c1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE id = ?').get('c1').n, 0);
}));

test('deleteChunk: removes chunk from chunks_fts', () => withDb((db) => {
  insertChunk(db, { id: 'c1', text: 'unique token xyz' });
  deleteChunk(db, 'c1');
  const rows = db.prepare(`SELECT id FROM chunks_fts WHERE chunks_fts MATCH '"xyz"'`).all();
  assert.equal(rows.length, 0);
}));

test('deleteChunk: no-op for unknown id', () => withDb((db) => {
  insertChunk(db, { id: 'c1' });
  deleteChunk(db, 'nonexistent');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 1);
}));

test('deleteChunk: only removes the targeted chunk', () => withDb((db) => {
  insertChunk(db, { id: 'c1' });
  insertChunk(db, { id: 'c2' });
  deleteChunk(db, 'c1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 1);
  assert.ok(db.prepare('SELECT id FROM chunks WHERE id = ?').get('c2'));
}));

// ── deleteFile ────────────────────────────────────────────────────────────────

test('deleteFile: removes all chunks for that path', () => withDb((db) => {
  insertChunk(db, { id: 'c1', path: 'notes.md' });
  insertChunk(db, { id: 'c2', path: 'notes.md' });
  insertFile(db, 'notes.md');
  deleteFile(db, 'notes.md');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE path = ?').get('notes.md').n, 0);
}));

test('deleteFile: removes the file row', () => withDb((db) => {
  insertFile(db, 'notes.md');
  deleteFile(db, 'notes.md');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files WHERE path = ?').get('notes.md').n, 0);
}));

test('deleteFile: does not remove chunks from other paths', () => withDb((db) => {
  insertChunk(db, { id: 'c1', path: 'notes.md' });
  insertChunk(db, { id: 'c2', path: 'other.md' });
  insertFile(db, 'notes.md');
  deleteFile(db, 'notes.md');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE path = ?').get('other.md').n, 1);
}));

// ── updateChunk ───────────────────────────────────────────────────────────────

test('updateChunk: updates text in chunks table', () => withDb((db) => {
  insertChunk(db, { id: 'c1', text: 'original' });
  updateChunk(db, 'c1', 'updated text');
  assert.equal(db.prepare('SELECT text FROM chunks WHERE id = ?').get('c1').text, 'updated text');
}));

test('updateChunk: sets user_edited flag', () => withDb((db) => {
  insertChunk(db, { id: 'c1', userEdited: 0 });
  updateChunk(db, 'c1', 'new text');
  assert.equal(db.prepare('SELECT user_edited FROM chunks WHERE id = ?').get('c1').user_edited, 1);
}));

test('updateChunk: updates text in chunks_fts', () => withDb((db) => {
  insertChunk(db, { id: 'c1', text: 'oldtoken' });
  updateChunk(db, 'c1', 'newtoken');
  const rows = db.prepare(`SELECT id FROM chunks_fts WHERE chunks_fts MATCH '"newtoken"'`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'c1');
}));

// ── pinChunk ──────────────────────────────────────────────────────────────────

test('pinChunk: sets pinned to 1', () => withDb((db) => {
  insertChunk(db, { id: 'c1', pinned: 0 });
  pinChunk(db, 'c1', true);
  assert.equal(db.prepare('SELECT pinned FROM chunks WHERE id = ?').get('c1').pinned, 1);
}));

test('pinChunk: sets pinned to 0', () => withDb((db) => {
  insertChunk(db, { id: 'c1', pinned: 1 });
  pinChunk(db, 'c1', false);
  assert.equal(db.prepare('SELECT pinned FROM chunks WHERE id = ?').get('c1').pinned, 0);
}));

// ── listChunks ────────────────────────────────────────────────────────────────

test('listChunks: returns all chunks with total', () => withDb((db) => {
  insertChunk(db, { id: 'c1' });
  insertChunk(db, { id: 'c2' });
  const result = listChunks(db, { page: 0, pageSize: 10 });
  assert.equal(result.total, 2);
  assert.equal(result.chunks.length, 2);
}));

test('listChunks: paginates correctly', () => withDb((db) => {
  insertChunk(db, { id: 'c1', path: 'a.md' });
  insertChunk(db, { id: 'c2', path: 'b.md' });
  insertChunk(db, { id: 'c3', path: 'c.md' });
  const page0 = listChunks(db, { page: 0, pageSize: 2 });
  const page1 = listChunks(db, { page: 1, pageSize: 2 });
  assert.equal(page0.chunks.length, 2);
  assert.equal(page1.chunks.length, 1);
  assert.equal(page0.total, 3);
  assert.equal(page1.total, 3);
}));

test('listChunks: filters by source', () => withDb((db) => {
  insertChunk(db, { id: 'c1', source: 'memory' });
  insertChunk(db, { id: 'c2', source: 'sessions' });
  const result = listChunks(db, { source: 'memory', page: 0, pageSize: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.chunks[0].source, 'memory');
}));

test('listChunks: source=all returns all chunks', () => withDb((db) => {
  insertChunk(db, { id: 'c1', source: 'memory' });
  insertChunk(db, { id: 'c2', source: 'sessions' });
  const result = listChunks(db, { source: 'all', page: 0, pageSize: 10 });
  assert.equal(result.total, 2);
}));

test('listChunks: maps pinned integer to boolean', () => withDb((db) => {
  insertChunk(db, { id: 'c1', pinned: 1 });
  const result = listChunks(db, { page: 0, pageSize: 10 });
  assert.equal(result.chunks[0].pinned, true);
}));

test('listChunks: maps user_edited integer to boolean', () => withDb((db) => {
  insertChunk(db, { id: 'c1', userEdited: 1 });
  const result = listChunks(db, { page: 0, pageSize: 10 });
  assert.equal(result.chunks[0].userEdited, true);
}));

test('listChunks: empty db returns total 0', () => withDb((db) => {
  const result = listChunks(db, { page: 0, pageSize: 10 });
  assert.equal(result.total, 0);
  assert.equal(result.chunks.length, 0);
}));
