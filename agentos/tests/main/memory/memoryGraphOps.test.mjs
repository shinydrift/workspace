/**
 * Tests for src/main/memory/memoryGraphOps.ts
 * linkEntities and addObservation are inlined along with their graph.ts /
 * observationService.ts dependencies. Uses node:sqlite (DatabaseSync) so no
 * native better-sqlite3 module is required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ── Minimal schema (subset of db.ts) ──────────────────────────────────────────

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
CREATE INDEX IF NOT EXISTS idx_entities_project_name ON entities(project_id, name);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(project_id, from_id);

CREATE TABLE IF NOT EXISTS entity_chunks (
  entity_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  PRIMARY KEY (entity_id, chunk_id)
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

// ── Helpers inlined from graph.ts / sync.ts ───────────────────────────────────

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function entityId(projectId, name, type) {
  return crypto.createHash('sha256').update(`${projectId}:${type}:${name}`).digest('hex').slice(0, 16);
}

function edgeId(projectId, fromId, toId, relation) {
  return crypto.createHash('sha256').update(`${projectId}:${fromId}:${toId}:${relation}`).digest('hex').slice(0, 16);
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Thin transaction wrapper for node:sqlite (no db.transaction() method) ────
// node:sqlite (DatabaseSync) uses exec('BEGIN'/'COMMIT') rather than the
// better-sqlite3 db.transaction(fn)() pattern.

function withTx(db, fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── assertObservation (from observationService.ts) ───────────────────────────

function observationId(eId, text) {
  return hashText(`${eId}:${text}`);
}

// assertObservation is always called inside an outer transaction in the
// production code. In tests we mirror that by not nesting another transaction.
function assertObservation(db, eId, text, projectId, sourceChunkId) {
  const id = observationId(eId, text);
  const now = Date.now();
  const { changes } = db
    .prepare(
      'INSERT OR IGNORE INTO observations (id, entity_id, project_id, text, source_chunk_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, eId, projectId, text, sourceChunkId ?? null, now);
  if (changes > 0) {
    db.prepare('INSERT INTO observations_fts (id, entity_id, project_id, text) VALUES (?, ?, ?, ?)').run(
      id,
      eId,
      projectId,
      text
    );
  }
  return id;
}

// ── assertEntityWithObservation (from graph.ts) ───────────────────────────────

function assertEntityWithObservation(db, projectId, name, type, observation, chunkId, opts) {
  const now = opts?.now ?? Date.now();
  const id = entityId(projectId, name, type);
  const selectEntity = db.prepare('SELECT id, chunk_ids FROM entities WHERE id = ?');
  const updateChunkIds = db.prepare('UPDATE entities SET chunk_ids = ?, updated_at = ? WHERE id = ?');
  const insertEntity = db.prepare(
    'INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertEntityChunk = db.prepare('INSERT OR IGNORE INTO entity_chunks (entity_id, chunk_id) VALUES (?, ?)');

  // No nested transaction — caller (linkEntities or addObservation) manages the tx.
  const existing = selectEntity.get(id);
  if (existing) {
    if (chunkId) {
      const ids = parseJsonArray(existing.chunk_ids);
      if (!ids.includes(chunkId)) {
        updateChunkIds.run(JSON.stringify([...ids, chunkId]), now, id);
        insertEntityChunk.run(id, chunkId);
      }
    }
  } else {
    insertEntity.run(id, projectId, name, type, '[]', JSON.stringify(chunkId ? [chunkId] : []), now, now);
    if (chunkId) insertEntityChunk.run(id, chunkId);
  }
  assertObservation(db, id, observation, projectId, chunkId);
}

// ── linkEntities (from memoryGraphOps.ts) ────────────────────────────────────

function linkEntities(db, projectId, params) {
  const now = Date.now();
  const { chunkId } = params;

  const selectEdge = db.prepare('SELECT id FROM edges WHERE id = ?');
  const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const updateEdgeWeight = db.prepare('UPDATE edges SET weight = weight + 1 WHERE id = ?');
  const selectByName = db.prepare('SELECT id FROM entities WHERE project_id = ? AND name = ?');
  const selectEntity = db.prepare('SELECT id, chunk_ids FROM entities WHERE id = ?');
  const insertEntity = db.prepare(
    'INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const updateChunkIds = db.prepare('UPDATE entities SET chunk_ids = ?, updated_at = ? WHERE id = ?');
  const insertEntityChunk = db.prepare('INSERT OR IGNORE INTO entity_chunks (entity_id, chunk_id) VALUES (?, ?)');

  withTx(db, () => {
    for (const { name, type, observation } of params.entities ?? []) {
      if (observation) {
        assertEntityWithObservation(db, projectId, name, type, observation, chunkId, { now });
      } else {
        const id = entityId(projectId, name, type);
        const existing = selectEntity.get(id);
        if (existing) {
          if (chunkId) {
            const ids = parseJsonArray(existing.chunk_ids);
            if (!ids.includes(chunkId)) {
              updateChunkIds.run(JSON.stringify([...ids, chunkId]), now, id);
              insertEntityChunk.run(id, chunkId);
            }
          }
        } else {
          insertEntity.run(id, projectId, name, type, '[]', JSON.stringify(chunkId ? [chunkId] : []), now, now);
          if (chunkId) insertEntityChunk.run(id, chunkId);
        }
      }
    }

    const resolveId = (name) => {
      const row = selectByName.get(projectId, name);
      return row?.id ?? null;
    };

    for (const { from, to, relation } of params.edges ?? []) {
      if (from === to) continue;
      const fromId = resolveId(from);
      const toId = resolveId(to);
      if (!fromId || !toId || fromId === toId) continue;
      const id = edgeId(projectId, fromId, toId, relation);
      if (selectEdge.get(id)) {
        updateEdgeWeight.run(id);
      } else {
        insertEdge.run(id, projectId, fromId, toId, relation, 1.0, chunkId ?? 'manual', now);
      }
    }
  });
}

// ── addObservation (from memoryGraphOps.ts) ───────────────────────────────────

function addObservation(db, projectId, params) {
  // Wrap in a transaction since there's no outer one here.
  withTx(db, () => {
    assertEntityWithObservation(db, projectId, params.entityName, params.entityType, params.observation, params.sourceChunkId);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('linkEntities: inserts a new entity without observation', () => {
  const db = openDb();
  linkEntities(db, 'proj', { entities: [{ name: 'auth.ts', type: 'file' }] });
  const row = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name = ?').get('proj', 'auth.ts');
  assert.ok(row, 'entity row should exist');
  assert.equal(row.type, 'file');
});

test('linkEntities: inserts entity with observation', () => {
  const db = openDb();
  linkEntities(db, 'proj', {
    entities: [{ name: 'login', type: 'symbol', observation: 'Handles OAuth flow' }],
  });
  const row = db.prepare('SELECT * FROM entities WHERE name = ?').get('login');
  assert.ok(row);
  const obs = db.prepare('SELECT * FROM observations WHERE entity_id = ?').get(row.id);
  assert.ok(obs, 'observation should be stored');
  assert.equal(obs.text, 'Handles OAuth flow');
});

test('linkEntities: attaches chunkId to entity', () => {
  const db = openDb();
  linkEntities(db, 'proj', { chunkId: 'chunk1', entities: [{ name: 'foo', type: 'concept' }] });
  const row = db.prepare("SELECT * FROM entities WHERE name = 'foo'").get();
  assert.ok(JSON.parse(row.chunk_ids).includes('chunk1'));
  const ec = db.prepare('SELECT * FROM entity_chunks WHERE chunk_id = ?').get('chunk1');
  assert.ok(ec, 'entity_chunks row should exist');
});

test('linkEntities: creates an edge between two entities', () => {
  const db = openDb();
  linkEntities(db, 'proj', {
    entities: [{ name: 'A', type: 'file' }, { name: 'B', type: 'file' }],
    edges: [{ from: 'A', to: 'B', relation: 'depends_on' }],
  });
  const edge = db.prepare('SELECT * FROM edges WHERE project_id = ?').get('proj');
  assert.ok(edge, 'edge should be created');
  assert.equal(edge.relation, 'depends_on');
  assert.equal(edge.weight, 1.0);
});

test('linkEntities: increments edge weight on repeated link', () => {
  const db = openDb();
  linkEntities(db, 'proj', {
    entities: [{ name: 'A', type: 'file' }, { name: 'B', type: 'file' }],
    edges: [{ from: 'A', to: 'B', relation: 'related_to' }],
  });
  linkEntities(db, 'proj', {
    edges: [{ from: 'A', to: 'B', relation: 'related_to' }],
  });
  const edge = db.prepare('SELECT weight FROM edges WHERE project_id = ?').get('proj');
  assert.equal(edge.weight, 2);
});

test('linkEntities: skips self-edges (from === to)', () => {
  const db = openDb();
  linkEntities(db, 'proj', {
    entities: [{ name: 'X', type: 'file' }],
    edges: [{ from: 'X', to: 'X', relation: 'related_to' }],
  });
  const edges = db.prepare('SELECT * FROM edges').all();
  assert.equal(edges.length, 0, 'self-edge should not be inserted');
});

test('linkEntities: skips edge when entity name not yet in db', () => {
  const db = openDb();
  linkEntities(db, 'proj', {
    edges: [{ from: 'ghost', to: 'nobody', relation: 'fixes' }],
  });
  const edges = db.prepare('SELECT * FROM edges').all();
  assert.equal(edges.length, 0);
});

test('linkEntities: does not duplicate chunkId in entity', () => {
  const db = openDb();
  linkEntities(db, 'proj', { chunkId: 'c1', entities: [{ name: 'dup', type: 'file' }] });
  linkEntities(db, 'proj', { chunkId: 'c1', entities: [{ name: 'dup', type: 'file' }] });
  const row = db.prepare("SELECT chunk_ids FROM entities WHERE name = 'dup'").get();
  const ids = JSON.parse(row.chunk_ids);
  assert.equal(ids.filter((id) => id === 'c1').length, 1, 'chunkId should appear only once');
});

test('addObservation: creates entity and stores observation', () => {
  const db = openDb();
  addObservation(db, 'proj', {
    entityName: 'tokenizer',
    entityType: 'symbol',
    observation: 'Splits input by whitespace',
  });
  const entity = db.prepare("SELECT * FROM entities WHERE name = 'tokenizer'").get();
  assert.ok(entity);
  const obs = db.prepare('SELECT text FROM observations WHERE entity_id = ?').get(entity.id);
  assert.ok(obs);
  assert.equal(obs.text, 'Splits input by whitespace');
});

test('addObservation: observation is idempotent (duplicate ignored)', () => {
  const db = openDb();
  addObservation(db, 'proj', { entityName: 'fn', entityType: 'symbol', observation: 'does X' });
  addObservation(db, 'proj', { entityName: 'fn', entityType: 'symbol', observation: 'does X' });
  const rows = db.prepare("SELECT * FROM observations WHERE text = 'does X'").all();
  assert.equal(rows.length, 1, 'duplicate observation should not be inserted twice');
});

test('addObservation: stores sourceChunkId on observation', () => {
  const db = openDb();
  addObservation(db, 'proj', {
    entityName: 'bar',
    entityType: 'concept',
    observation: 'key concept',
    sourceChunkId: 'chunk42',
  });
  const entity = db.prepare("SELECT id FROM entities WHERE name = 'bar'").get();
  const obs = db.prepare('SELECT source_chunk_id FROM observations WHERE entity_id = ?').get(entity.id);
  assert.equal(obs.source_chunk_id, 'chunk42');
});
