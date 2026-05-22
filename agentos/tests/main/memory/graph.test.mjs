/**
 * Tests for memory/graph.ts — EntityExtractor, EdgeInferrer, GraphQueryEngine.
 * Uses node:sqlite (DatabaseSync) to avoid Electron ABI issues with better-sqlite3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ── Schema (inlined from db.ts) ───────────────────────────────────────────────

const SCHEMA_SQL = `
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
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(project_id, to_id);
`;

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Inlined helpers from graph.ts ─────────────────────────────────────────────

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

// Regex patterns
const FILE_RE = /\b([\w\-./]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|cpp|c|md|json|yaml|yml|toml|sh|css|html))\b/g;
const PASCAL_SYMBOL_RE = /\b([A-Z][a-z][a-zA-Z0-9]*(?:[A-Z][a-z][a-zA-Z0-9]*)+)\b/g;
const CAMEL_SYMBOL_RE = /\b([a-z][a-z0-9]+(?:[A-Z][a-z][a-zA-Z0-9]+)+)\b/g;
const ISSUE_RE = /\b(?:issue\s*#?|PR\s*#?|fix\s*#|closes\s*#|resolves\s*#)(\d+)\b/gi;
const DECISION_RE =
  /\b(?:we\s+decided|agreed\s+to|switched\s+from|we\s+will\s+use|decided\s+to\s+use|we\s+chose|we\s+are\s+using)\b.{0,120}/gi;

function extractEntities(text) {
  const found = [];
  for (const m of text.matchAll(FILE_RE)) {
    const name = m[1].replace(/^\.\//, '');
    if (name.length > 3 && name.length < 200) found.push({ name, type: 'file' });
  }
  for (const m of text.matchAll(PASCAL_SYMBOL_RE)) {
    if (m[1].length >= 4 && m[1].length < 80) found.push({ name: m[1], type: 'symbol' });
  }
  for (const m of text.matchAll(CAMEL_SYMBOL_RE)) {
    if (m[1].length >= 4 && m[1].length < 80) found.push({ name: m[1], type: 'symbol' });
  }
  for (const m of text.matchAll(ISSUE_RE)) {
    found.push({ name: `#${m[1]}`, type: 'issue' });
  }
  for (const m of text.matchAll(DECISION_RE)) {
    const phrase = m[0].trim().slice(0, 80);
    if (phrase.length >= 10) found.push({ name: phrase, type: 'decision' });
  }
  const seen = new Set();
  return found.filter(({ name, type }) => {
    const key = `${type}:${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── parseJsonArray ────────────────────────────────────────────────────────────

test('parseJsonArray returns empty array for invalid JSON', () => {
  assert.deepEqual(parseJsonArray('not-json'), []);
});

test('parseJsonArray returns empty array for empty string', () => {
  assert.deepEqual(parseJsonArray(''), []);
});

test('parseJsonArray returns array for valid JSON array', () => {
  assert.deepEqual(parseJsonArray('["a","b"]'), ['a', 'b']);
});

test('parseJsonArray returns empty array for non-array JSON', () => {
  assert.deepEqual(parseJsonArray('{"key":"val"}'), []);
});

// ── entityId / edgeId determinism ────────────────────────────────────────────

test('entityId is deterministic for same inputs', () => {
  const id1 = entityId('proj', 'MyClass', 'symbol');
  const id2 = entityId('proj', 'MyClass', 'symbol');
  assert.equal(id1, id2);
});

test('entityId differs across types', () => {
  const a = entityId('proj', 'auth.ts', 'file');
  const b = entityId('proj', 'auth.ts', 'symbol');
  assert.notEqual(a, b);
});

test('entityId is 16 hex chars', () => {
  const id = entityId('proj', 'Foo', 'file');
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('edgeId is deterministic', () => {
  const a = edgeId('proj', 'id1', 'id2', 'related_to');
  const b = edgeId('proj', 'id1', 'id2', 'related_to');
  assert.equal(a, b);
});

// ── Entity extraction ─────────────────────────────────────────────────────────

test('file extraction recognises .ts extension', () => {
  const entities = extractEntities('Modified auth.ts to fix the bug');
  assert.ok(entities.some((e) => e.name === 'auth.ts' && e.type === 'file'));
});

test('file extraction recognises multiple extensions', () => {
  const entities = extractEntities('Changed config.json and styles.css');
  const names = entities.map((e) => e.name);
  assert.ok(names.includes('config.json'));
  assert.ok(names.includes('styles.css'));
});

test('PascalCase symbol extraction', () => {
  const entities = extractEntities('The MemoryService handles all queries');
  assert.ok(entities.some((e) => e.name === 'MemoryService' && e.type === 'symbol'));
});

test('camelCase symbol extraction', () => {
  const entities = extractEntities('Call searchMemory to find results');
  assert.ok(entities.some((e) => e.name === 'searchMemory' && e.type === 'symbol'));
});

test('issue reference extraction', () => {
  const entities = extractEntities('fix #42 closes #100');
  const issues = entities.filter((e) => e.type === 'issue').map((e) => e.name);
  assert.ok(issues.includes('#42'));
  assert.ok(issues.includes('#100'));
});

test('decision marker extraction', () => {
  const entities = extractEntities('We decided to use SQLite for storage in the new system');
  assert.ok(entities.some((e) => e.type === 'decision'));
});

test('entity deduplication within a chunk', () => {
  const entities = extractEntities('auth.ts and auth.ts are the same file');
  const files = entities.filter((e) => e.type === 'file' && e.name === 'auth.ts');
  assert.equal(files.length, 1);
});

// ── DB-based: EntityExtractor upsert ─────────────────────────────────────────

function dbExtractFromChunk(db, projectId, chunkId, text) {
  const now = Date.now();
  const entities = extractEntities(text);
  const selectStmt = db.prepare('SELECT * FROM entities WHERE id = ?');
  const updateStmt = db.prepare('UPDATE entities SET chunk_ids = ?, updated_at = ? WHERE id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const upserted = [];
  for (const { name, type } of entities) {
    const id = entityId(projectId, name, type);
    const existing = selectStmt.get(id);
    if (existing) {
      const chunkIds = parseJsonArray(existing.chunk_ids);
      if (!chunkIds.includes(chunkId)) {
        chunkIds.push(chunkId);
        updateStmt.run(JSON.stringify(chunkIds), now, id);
      }
      upserted.push({ id, name, type, chunkIds });
    } else {
      insertStmt.run(id, projectId, name, type, '[]', JSON.stringify([chunkId]), now, now);
      upserted.push({ id, name, type, chunkIds: [chunkId] });
    }
  }
  return upserted;
}

test('extractFromChunk inserts entity into DB', () => {
  const db = openDb();
  const entities = dbExtractFromChunk(db, 'proj1', 'chunk1', 'Modified auth.ts to fix the bug');
  assert.ok(entities.some((e) => e.name === 'auth.ts'));
  const row = db.prepare("SELECT * FROM entities WHERE name = 'auth.ts'").get();
  assert.ok(row);
  assert.equal(row.project_id, 'proj1');
  db.close();
});

test('extractFromChunk updates chunk_ids for existing entity', () => {
  const db = openDb();
  dbExtractFromChunk(db, 'proj1', 'chunk1', 'Modified auth.ts');
  dbExtractFromChunk(db, 'proj1', 'chunk2', 'Also changed auth.ts here');
  const row = db.prepare("SELECT chunk_ids FROM entities WHERE name = 'auth.ts'").get();
  const chunkIds = parseJsonArray(row.chunk_ids);
  assert.ok(chunkIds.includes('chunk1'));
  assert.ok(chunkIds.includes('chunk2'));
  db.close();
});

test('extractFromChunk does not duplicate chunk_id on same chunk', () => {
  const db = openDb();
  dbExtractFromChunk(db, 'proj1', 'chunk1', 'Modified auth.ts');
  dbExtractFromChunk(db, 'proj1', 'chunk1', 'Modified auth.ts');
  const row = db.prepare("SELECT chunk_ids FROM entities WHERE name = 'auth.ts'").get();
  const chunkIds = parseJsonArray(row.chunk_ids);
  assert.equal(chunkIds.length, 1);
  db.close();
});

// ── DB-based: EdgeInferrer co-mention ────────────────────────────────────────

function dbInferEdges(db, projectId, chunkId, text, entities) {
  const now = Date.now();
  const selectEdge = db.prepare('SELECT id FROM edges WHERE id = ?');
  const updateEdge = db.prepare('UPDATE edges SET weight = weight + 1 WHERE id = ?');
  const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const upsertEdge = (fromId, toId, relation, source) => {
    if (fromId === toId) return;
    const id = edgeId(projectId, fromId, toId, relation);
    if (selectEdge.get(id)) {
      updateEdge.run(id);
    } else {
      insertEdge.run(id, projectId, fromId, toId, relation, 1.0, source, now);
    }
  };

  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    const mentioned = entities.filter((e) => para.includes(e.name)).slice(0, 20);
    for (let i = 0; i < mentioned.length; i++) {
      for (let j = i + 1; j < mentioned.length; j++) {
        upsertEdge(mentioned[i].id, mentioned[j].id, 'related_to', chunkId);
      }
    }
  }
}

test('co-mention inference creates related_to edge', () => {
  const db = openDb();
  const entities = dbExtractFromChunk(db, 'proj1', 'chunk1', 'auth.ts and MemoryService work together');
  dbInferEdges(db, 'proj1', 'chunk1', 'auth.ts and MemoryService work together', entities);
  const edges = db.prepare('SELECT * FROM edges WHERE project_id = ?').all('proj1');
  assert.ok(edges.length >= 1);
  assert.equal(edges[0].relation, 'related_to');
  db.close();
});

test('edge weight increments on repeated co-mention', () => {
  const db = openDb();
  const e1 = dbExtractFromChunk(db, 'proj1', 'c1', 'auth.ts and MemoryService');
  dbInferEdges(db, 'proj1', 'c1', 'auth.ts and MemoryService', e1);
  const e2 = dbExtractFromChunk(db, 'proj1', 'c2', 'auth.ts and MemoryService again');
  dbInferEdges(db, 'proj1', 'c2', 'auth.ts and MemoryService again', e2);
  const edges = db.prepare('SELECT * FROM edges WHERE project_id = ?').all('proj1');
  assert.ok(edges.some((e) => e.weight >= 2));
  db.close();
});

test('self-edge is not created', () => {
  const db = openDb();
  const entities = dbExtractFromChunk(db, 'proj1', 'c1', 'auth.ts is a great file auth.ts');
  // Only one entity — no pair → no edge
  dbInferEdges(db, 'proj1', 'c1', 'auth.ts is a great file auth.ts', entities);
  const edges = db.prepare('SELECT * FROM edges WHERE project_id = ?').all('proj1');
  assert.equal(edges.length, 0);
  db.close();
});

// ── DB-based: GraphQueryEngine.graphQuery ────────────────────────────────────

function insertEntity(db, projectId, name, type, chunkIds = []) {
  const id = entityId(projectId, name, type);
  const now = Date.now();
  db.prepare(
    'INSERT OR IGNORE INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, name, type, '[]', JSON.stringify(chunkIds), now, now);
  return id;
}

function insertEdge(db, projectId, fromId, toId, relation) {
  const id = edgeId(projectId, fromId, toId, relation);
  const now = Date.now();
  db.prepare(
    'INSERT OR IGNORE INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, fromId, toId, relation, 1.0, '', now);
  return id;
}

function graphQuery(db, projectId, entityName, options = {}) {
  const { maxHops = 2, topK = 50 } = options;

  const root = db.prepare('SELECT * FROM entities WHERE project_id = ? AND name LIKE ? LIMIT 1')
    .get(projectId, `%${entityName}%`);
  if (!root) return { nodes: [], edges: [] };

  const nodeMap = new Map([[root.id, root]]);
  const edgeMap = new Map();

  const selectEntityStmt = db.prepare('SELECT * FROM entities WHERE id = ?');
  const edgeStmt = db.prepare(
    `SELECT * FROM edges WHERE project_id = ? AND from_id = ?
     UNION ALL
     SELECT * FROM edges WHERE project_id = ? AND to_id = ?`
  );

  let frontier = [root.id];
  for (let hop = 0; hop < maxHops; hop++) {
    const next = [];
    for (const eid of frontier) {
      if (nodeMap.size >= topK) break;
      const edges = edgeStmt.all(projectId, eid, projectId, eid);
      for (const e of edges) {
        if (!edgeMap.has(e.id)) edgeMap.set(e.id, e);
        const neighborId = e.from_id === eid ? e.to_id : e.from_id;
        if (!nodeMap.has(neighborId)) {
          const neighborRow = selectEntityStmt.get(neighborId);
          if (neighborRow) {
            nodeMap.set(neighborId, neighborRow);
            next.push(neighborId);
          }
        }
      }
    }
    frontier = next;
    if (frontier.length === 0 || nodeMap.size >= topK) break;
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

function graphAll(db, projectId, topK = 200) {
  const nodes = db
    .prepare('SELECT * FROM entities WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(projectId, topK);

  if (nodes.length === 0) return { nodes: [], edges: [] };

  const nodeIds = nodes.map((node) => node.id);
  const placeholders = nodeIds.map(() => '?').join(', ');
  const edges = db
    .prepare(
      `SELECT * FROM edges
       WHERE project_id = ?
         AND from_id IN (${placeholders})
         AND to_id IN (${placeholders})
       ORDER BY weight DESC`
    )
    .all(projectId, ...nodeIds, ...nodeIds);

  return { nodes, edges };
}

test('graphQuery returns empty for unknown entity', () => {
  const db = openDb();
  const result = graphQuery(db, 'proj', 'nonexistent');
  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
  db.close();
});

test('graphQuery returns root node when found', () => {
  const db = openDb();
  insertEntity(db, 'proj', 'auth.ts', 'file', ['c1']);
  const result = graphQuery(db, 'proj', 'auth.ts');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].name, 'auth.ts');
  db.close();
});

test('graphQuery traverses one hop to connected nodes', () => {
  const db = openDb();
  const aId = insertEntity(db, 'proj', 'auth.ts', 'file');
  const bId = insertEntity(db, 'proj', 'service.ts', 'file');
  insertEdge(db, 'proj', aId, bId, 'related_to');
  const result = graphQuery(db, 'proj', 'auth.ts');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  db.close();
});

test('graphQuery respects maxHops=1', () => {
  const db = openDb();
  const aId = insertEntity(db, 'proj', 'a.ts', 'file');
  const bId = insertEntity(db, 'proj', 'b.ts', 'file');
  const cId = insertEntity(db, 'proj', 'c.ts', 'file');
  insertEdge(db, 'proj', aId, bId, 'related_to');
  insertEdge(db, 'proj', bId, cId, 'related_to');
  const result = graphQuery(db, 'proj', 'a.ts', { maxHops: 1 });
  // Only a and b (not c) since maxHops=1
  const names = result.nodes.map((n) => n.name);
  assert.ok(names.includes('a.ts'));
  assert.ok(names.includes('b.ts'));
  assert.ok(!names.includes('c.ts'));
  db.close();
});

test('graphQuery partial name match works', () => {
  const db = openDb();
  insertEntity(db, 'proj', 'authentication.ts', 'file');
  const result = graphQuery(db, 'proj', 'auth');
  assert.equal(result.nodes.length, 1);
  db.close();
});

test('graphAll only returns edges between the selected topK nodes', () => {
  const db = openDb();
  const aId = insertEntity(db, 'proj', 'a.ts', 'file');
  const bId = insertEntity(db, 'proj', 'b.ts', 'file');
  const cId = insertEntity(db, 'proj', 'c.ts', 'file');

  db.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(1, aId);
  db.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(2, bId);
  db.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(3, cId);

  insertEdge(db, 'proj', cId, bId, 'related_to');
  insertEdge(db, 'proj', aId, bId, 'related_to');

  const result = graphAll(db, 'proj', 2);
  assert.deepEqual(
    result.nodes.map((node) => node.name).sort(),
    ['b.ts', 'c.ts']
  );
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].from_id, cId);
  assert.equal(result.edges[0].to_id, bId);
  db.close();
});

// ── DB-based: GraphQueryEngine.expandContext ─────────────────────────────────

function expandContext(db, projectId, queryText, topChunkIds) {
  const result = new Set();
  const topChunkSet = new Set(topChunkIds);

  const queryEntities = [];
  for (const m of queryText.matchAll(FILE_RE)) queryEntities.push(m[1]);
  for (const m of queryText.matchAll(PASCAL_SYMBOL_RE)) queryEntities.push(m[1]);
  for (const m of queryText.matchAll(CAMEL_SYMBOL_RE)) queryEntities.push(m[1]);

  if (queryEntities.length === 0 && topChunkIds.length === 0) return result;

  const seedEntityIds = new Set();
  const entityByName = db.prepare('SELECT id FROM entities WHERE project_id = ? AND name LIKE ?');
  for (const name of queryEntities) {
    const rows = entityByName.all(projectId, `%${name}%`);
    for (const row of rows) seedEntityIds.add(row.id);
  }

  const entityByChunk = db.prepare(
    `SELECT id FROM entities WHERE project_id = ?
     AND EXISTS (SELECT 1 FROM json_each(chunk_ids) AS j WHERE j.value = ?)`
  );
  for (const chunkId of topChunkIds) {
    const rows = entityByChunk.all(projectId, chunkId);
    for (const row of rows) seedEntityIds.add(row.id);
  }

  if (seedEntityIds.size === 0) return result;

  const visited = new Set(seedEntityIds);
  let frontier = [...seedEntityIds];
  const neighborsStmt = db.prepare(
    `SELECT to_id AS neighbor_id FROM edges WHERE project_id = ? AND from_id = ?
     UNION
     SELECT from_id AS neighbor_id FROM edges WHERE project_id = ? AND to_id = ?`
  );
  for (let hop = 0; hop < 2; hop++) {
    const next = [];
    for (const eid of frontier) {
      const neighbors = neighborsStmt.all(projectId, eid, projectId, eid);
      for (const { neighbor_id } of neighbors) {
        if (!visited.has(neighbor_id)) {
          visited.add(neighbor_id);
          next.push(neighbor_id);
        }
      }
    }
    frontier = next;
  }

  const chunkStmt = db.prepare('SELECT chunk_ids FROM entities WHERE id = ?');
  for (const eid of visited) {
    const entity = chunkStmt.get(eid);
    if (entity) {
      const ids = parseJsonArray(entity.chunk_ids);
      for (const cid of ids) {
        if (!topChunkSet.has(cid)) result.add(cid);
      }
    }
  }

  return result;
}

test('expandContext returns empty set for empty query with no top chunks', () => {
  const db = openDb();
  const result = expandContext(db, 'proj', '', []);
  assert.equal(result.size, 0);
  db.close();
});

test('expandContext finds chunks via query entity name', () => {
  const db = openDb();
  insertEntity(db, 'proj', 'auth.ts', 'file', ['c10', 'c11']);
  const result = expandContext(db, 'proj', 'looking at auth.ts', []);
  assert.ok(result.has('c10'));
  assert.ok(result.has('c11'));
  db.close();
});

test('expandContext excludes topChunkIds from result', () => {
  const db = openDb();
  insertEntity(db, 'proj', 'auth.ts', 'file', ['c10']);
  const result = expandContext(db, 'proj', 'auth.ts', ['c10']);
  assert.ok(!result.has('c10'));
  db.close();
});

test('expandContext traverses edges to collect neighbor chunks', () => {
  const db = openDb();
  const aId = insertEntity(db, 'proj', 'auth.ts', 'file', ['c1']);
  const bId = insertEntity(db, 'proj', 'service.ts', 'file', ['c2']);
  insertEdge(db, 'proj', aId, bId, 'related_to');
  const result = expandContext(db, 'proj', 'auth.ts', []);
  assert.ok(result.has('c2'));
  db.close();
});
