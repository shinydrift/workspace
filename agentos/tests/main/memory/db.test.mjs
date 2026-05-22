/**
 * Functional tests for memory/db.ts — SQLite schema setup and FTS.
 * Uses node:sqlite (built-in, Node v22.5+) to avoid Electron ABI mismatch
 * with the better-sqlite3 binary compiled for Electron.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// ── Schema SQL (inlined from db.ts) ──────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
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
  summary TEXT NOT NULL DEFAULT '',
  embedding TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  context_header TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
CREATE TABLE IF NOT EXISTS embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON embedding_cache(updated_at);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, id UNINDEXED, path UNINDEXED, source UNINDEXED,
  model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED
);
`;

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  return db;
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','shadow') AND name = ?").get(name);
}

// ── Schema tests ──────────────────────────────────────────────────────────────

test('db schema creates all required tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    assert.ok(tableExists(db, 'meta'));
    assert.ok(tableExists(db, 'files'));
    assert.ok(tableExists(db, 'chunks'));
    assert.ok(tableExists(db, 'embedding_cache'));
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('db schema creates chunks_fts virtual table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    const hasFts = !!db.prepare("SELECT name FROM sqlite_master WHERE name = 'chunks_fts'").get();
    assert.ok(hasFts, 'chunks_fts should exist');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('db is idempotent — opening same path twice does not fail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const p = path.join(dir, 'test.sqlite');
    const db1 = openDb(p); db1.close();
    const db2 = openDb(p); db2.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── chunks CRUD ───────────────────────────────────────────────────────────────

test('chunks table inserts and retrieves a row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'chunk1', 'MEMORY.md', 'memory', 1, 10, 'abc123', 'local', 'hello world', '[]', Date.now()
    );
    const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get('chunk1');
    assert.equal(row.text, 'hello world');
    assert.equal(row.source, 'memory');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── FTS search ────────────────────────────────────────────────────────────────

test('FTS search finds inserted text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'c1', 'MEMORY.md', 'memory', 1, 5, 'h1', 'local', 'typescript programming language', '[]', Date.now()
    );
    db.prepare(`INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'typescript programming language', 'c1', 'MEMORY.md', 'memory', 'local', 1, 5
    );
    const rows = db.prepare(`SELECT id FROM chunks_fts WHERE chunks_fts MATCH '"typescript"'`).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'c1');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── embedding_cache ───────────────────────────────────────────────────────────

test('embedding_cache inserts and retrieves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'local', 'test-model', 'key1', 'texthash', '[0.1,0.2,0.3]', 3, Date.now()
    );
    const row = db.prepare(`SELECT embedding FROM embedding_cache WHERE hash = ?`).get('texthash');
    assert.equal(row.embedding, '[0.1,0.2,0.3]');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('embedding_cache LRU eviction by updated_at ordering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    for (let i = 1; i <= 3; i++) {
      db.prepare(`INSERT INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run('local', 'm', 'k', `h${i}`, '[]', 3, i * 1000);
    }
    // Oldest (updated_at=1000) should appear first when sorted ASC
    const oldest = db.prepare(`SELECT hash FROM embedding_cache ORDER BY updated_at ASC LIMIT 1`).get();
    assert.equal(oldest.hash, 'h1');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── files table ───────────────────────────────────────────────────────────────

test('files table tracks path, hash, mtime, size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`).run(
      'MEMORY.md', 'memory', 'abc', 1000, 256
    );
    const row = db.prepare(`SELECT * FROM files WHERE path = ?`).get('MEMORY.md');
    assert.equal(row.hash, 'abc');
    assert.equal(row.size, 256);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('chunks table stores and retrieves context_header', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at, context_header)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'c2', 'MEMORY.md', 'memory', 1, 5, 'h1', 'local', 'section text', '[]', Date.now(), '[MEMORY.md > chunk 1]'
    );
    const row = db.prepare('SELECT context_header FROM chunks WHERE id = ?').get('c2');
    assert.equal(row.context_header, '[MEMORY.md > chunk 1]');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('chunks table defaults context_header to empty string', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'c3', 'MEMORY.md', 'memory', 1, 5, 'h2', 'local', 'no header', '[]', Date.now()
    );
    const row = db.prepare('SELECT context_header FROM chunks WHERE id = ?').get('c3');
    assert.equal(row.context_header, '');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('files table upsert updates hash on change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-db-test-'));
  try {
    const db = openDb(path.join(dir, 'test.sqlite'));
    db.prepare(`INSERT INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`).run(
      'MEMORY.md', 'memory', 'old', 1000, 100
    );
    db.prepare(`INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`).run(
      'MEMORY.md', 'memory', 'new', 2000, 200
    );
    const row = db.prepare(`SELECT hash FROM files WHERE path = ?`).get('MEMORY.md');
    assert.equal(row.hash, 'new');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
