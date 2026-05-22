/**
 * Tests for memory/observationService.ts — observationId, assertObservation,
 * deleteObservation, searchObservations (inlined).
 * Uses node:sqlite (DatabaseSync) to avoid Electron ABI issues with better-sqlite3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ── Schema (inlined from db.ts) ───────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  chunk_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source_chunk_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(project_id, entity_id);
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  text, id UNINDEXED, entity_id UNINDEXED, project_id UNINDEXED
);
`;

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Inlined from sync.ts ──────────────────────────────────────────────────────

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

// ── Inlined from observationService.ts (adapted for node:sqlite — no .transaction()) ──

function observationId(entityId, text) {
  return hashText(`${entityId}:${text}`);
}

function assertObservation(db, entityId, text, projectId, sourceChunkId = null) {
  const id = observationId(entityId, text);
  const now = Date.now();
  const { changes } = db
    .prepare(
      'INSERT OR IGNORE INTO observations (id, entity_id, project_id, text, source_chunk_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, entityId, projectId, text, sourceChunkId, now);
  if (changes > 0) {
    db.prepare('INSERT INTO observations_fts (id, entity_id, project_id, text) VALUES (?, ?, ?, ?)').run(
      id, entityId, projectId, text
    );
  }
  return id;
}

function deleteObservation(db, id) {
  db.prepare('DELETE FROM observations_fts WHERE id = ?').run(id);
  db.prepare('DELETE FROM observations WHERE id = ?').run(id);
}

function buildFtsQuery(raw) {
  const tokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map((t) => t.toLowerCase()).filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replaceAll('"', '')}"`).join(' AND ');
}

function bm25RankToScore(rank) {
  const r = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + r);
}

function searchObservations(db, projectId, query, topK = 10) {
  const ftsQ = buildFtsQuery(query);
  if (!ftsQ) return [];

  const rows = db
    .prepare(
      `SELECT o.id AS obs_id, o.entity_id, o.text AS obs_text, o.created_at,
              e.name AS entity_name, e.type AS entity_type,
              -bm25(observations_fts) AS bm25_rank
       FROM observations_fts
       JOIN observations o ON o.id = observations_fts.id
       JOIN entities e ON e.id = o.entity_id
       WHERE observations_fts MATCH ? AND o.project_id = ?
       ORDER BY bm25_rank ASC LIMIT ?`
    )
    .all(ftsQ, projectId, topK * 2);

  if (rows.length === 0) return [];

  return rows
    .map((r) => ({
      entityId: r.entity_id,
      entityName: r.entity_name,
      entityType: r.entity_type,
      observationId: r.obs_id,
      text: r.obs_text,
      score: bm25RankToScore(r.bm25_rank),
      createdAt: r.created_at,
    }))
    .slice(0, topK);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function insertEntity(db, id, projectId, name, type = 'person') {
  const now = Date.now();
  db.prepare(
    'INSERT OR IGNORE INTO entities (id, project_id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, name, type, now, now);
}

// ── observationId ─────────────────────────────────────────────────────────────

test('observationId: returns 16-char hex string', () => {
  const id = observationId('entity1', 'some text');
  assert.equal(typeof id, 'string');
  assert.equal(id.length, 16);
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('observationId: same inputs produce same id', () => {
  assert.equal(observationId('e1', 'text'), observationId('e1', 'text'));
});

test('observationId: different inputs produce different ids', () => {
  assert.notEqual(observationId('e1', 'text'), observationId('e1', 'other'));
  assert.notEqual(observationId('e1', 'text'), observationId('e2', 'text'));
});

// ── assertObservation ─────────────────────────────────────────────────────────

test('assertObservation: inserts observation and returns id', () => {
  const db = openDb();
  const id = assertObservation(db, 'e1', 'hello world', 'proj1');
  assert.equal(typeof id, 'string');
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  assert.ok(row !== undefined);
  assert.equal(row.entity_id, 'e1');
  assert.equal(row.text, 'hello world');
  assert.equal(row.project_id, 'proj1');
});

test('assertObservation: is idempotent — duplicate insert ignored', () => {
  const db = openDb();
  const id1 = assertObservation(db, 'e1', 'hello', 'proj1');
  const id2 = assertObservation(db, 'e1', 'hello', 'proj1');
  assert.equal(id1, id2);
  const rows = db.prepare('SELECT * FROM observations WHERE entity_id = ?').all('e1');
  assert.equal(rows.length, 1);
});

test('assertObservation: inserts into FTS table', () => {
  const db = openDb();
  const id = assertObservation(db, 'e1', 'unique phrase', 'proj1');
  const ftsRow = db.prepare('SELECT * FROM observations_fts WHERE id = ?').get(id);
  assert.ok(ftsRow !== undefined);
  assert.equal(ftsRow.text, 'unique phrase');
});

test('assertObservation: stores source_chunk_id when provided', () => {
  const db = openDb();
  const id = assertObservation(db, 'e1', 'text', 'proj1', 'chunk-abc');
  const row = db.prepare('SELECT source_chunk_id FROM observations WHERE id = ?').get(id);
  assert.equal(row.source_chunk_id, 'chunk-abc');
});

test('assertObservation: source_chunk_id is null when omitted', () => {
  const db = openDb();
  const id = assertObservation(db, 'e1', 'text', 'proj1');
  const row = db.prepare('SELECT source_chunk_id FROM observations WHERE id = ?').get(id);
  assert.equal(row.source_chunk_id, null);
});

// ── deleteObservation ─────────────────────────────────────────────────────────

test('deleteObservation: removes from observations table', () => {
  const db = openDb();
  const id = assertObservation(db, 'e1', 'to delete', 'proj1');
  deleteObservation(db, id);
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  assert.equal(row, undefined);
});

test('deleteObservation: removes from FTS table', () => {
  const db = openDb();
  const id = assertObservation(db, 'e1', 'to delete fts', 'proj1');
  deleteObservation(db, id);
  const ftsRow = db.prepare('SELECT * FROM observations_fts WHERE id = ?').get(id);
  assert.equal(ftsRow, undefined);
});

test('deleteObservation: no-op for non-existent id', () => {
  const db = openDb();
  deleteObservation(db, 'nonexistent-id');
});

// ── searchObservations ────────────────────────────────────────────────────────

test('searchObservations: returns empty array for empty query', () => {
  const db = openDb();
  assert.deepEqual(searchObservations(db, 'proj1', ''), []);
});

test('searchObservations: returns empty array when no matches', () => {
  const db = openDb();
  insertEntity(db, 'e1', 'proj1', 'Alice');
  assertObservation(db, 'e1', 'likes cats', 'proj1');
  const results = searchObservations(db, 'proj1', 'xyz_no_match_999');
  assert.deepEqual(results, []);
});

test('searchObservations: finds matching observation', () => {
  const db = openDb();
  insertEntity(db, 'e1', 'proj1', 'Alice', 'person');
  assertObservation(db, 'e1', 'expert in distributed systems', 'proj1');
  const results = searchObservations(db, 'proj1', 'distributed');
  assert.equal(results.length, 1);
  assert.equal(results[0].entityName, 'Alice');
  assert.ok(results[0].text.includes('distributed'));
  assert.ok(results[0].score > 0 && results[0].score <= 1);
});

test('searchObservations: respects project isolation', () => {
  const db = openDb();
  insertEntity(db, 'e1', 'proj1', 'Alice', 'person');
  insertEntity(db, 'e2', 'proj2', 'Bob', 'person');
  assertObservation(db, 'e1', 'knowledge about golang', 'proj1');
  assertObservation(db, 'e2', 'knowledge about golang', 'proj2');
  const proj1Results = searchObservations(db, 'proj1', 'golang');
  assert.equal(proj1Results.length, 1);
  assert.equal(proj1Results[0].entityName, 'Alice');
});

test('searchObservations: result has expected shape', () => {
  const db = openDb();
  insertEntity(db, 'e1', 'proj1', 'Carol', 'organization');
  assertObservation(db, 'e1', 'builds open source software', 'proj1');
  const results = searchObservations(db, 'proj1', 'software');
  assert.equal(results.length, 1);
  const hit = results[0];
  assert.equal(typeof hit.entityId, 'string');
  assert.equal(typeof hit.entityName, 'string');
  assert.equal(typeof hit.entityType, 'string');
  assert.equal(typeof hit.observationId, 'string');
  assert.equal(typeof hit.text, 'string');
  assert.equal(typeof hit.score, 'number');
  assert.equal(typeof hit.createdAt, 'number');
  assert.equal(hit.entityType, 'organization');
});
