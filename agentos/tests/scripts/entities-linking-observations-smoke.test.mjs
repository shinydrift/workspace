/**
 * Smoke test: entities, linking, and observations — end-to-end flow.
 *
 * Scenario: a chunk is inserted, entities are extracted and registered,
 * observations are attached, edges link entities, then graph traversal
 * and observation search are verified.
 *
 * Uses node:sqlite (DatabaseSync) to avoid Electron ABI issues.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ── Schema ────────────────────────────────────────────────────────────────────

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

// ── Inlined helpers ───────────────────────────────────────────────────────────

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function entityId(projectId, name, type) {
  return hashText(`${projectId}:${type}:${name}`);
}

function edgeId(projectId, fromId, toId, relation) {
  return hashText(`${projectId}:${fromId}:${toId}:${relation}`);
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function observationId(entId, text) {
  return hashText(`${entId}:${text}`);
}

/** Insert or update an entity, and attach an observation. */
function assertEntityWithObservation(db, projectId, name, type, observation, chunkId = null) {
  const now = Date.now();
  const id = entityId(projectId, name, type);
  const existing = db.prepare('SELECT id, chunk_ids FROM entities WHERE id = ?').get(id);
  if (existing) {
    if (chunkId) {
      const ids = parseJsonArray(existing.chunk_ids);
      if (!ids.includes(chunkId)) {
        db.prepare('UPDATE entities SET chunk_ids = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify([...ids, chunkId]),
          now,
          id,
        );
      }
    }
  } else {
    db.prepare(
      'INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, projectId, name, type, '[]', JSON.stringify(chunkId ? [chunkId] : []), now, now);
  }
  assertObservation(db, id, observation, projectId, chunkId);
}

function assertObservation(db, entId, text, projectId, sourceChunkId = null) {
  const id = observationId(entId, text);
  const now = Date.now();
  const { changes } = db
    .prepare(
      'INSERT OR IGNORE INTO observations (id, entity_id, project_id, text, source_chunk_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, entId, projectId, text, sourceChunkId ?? null, now);
  if (changes > 0) {
    db.prepare('INSERT INTO observations_fts (id, entity_id, project_id, text) VALUES (?, ?, ?, ?)').run(
      id,
      entId,
      projectId,
      text,
    );
  }
  return id;
}

function upsertEdge(db, projectId, fromId, toId, relation, source = '') {
  if (fromId === toId) return null; // self-edges are never created
  const id = edgeId(projectId, fromId, toId, relation);
  const now = Date.now();
  const existing = db.prepare('SELECT id, weight FROM edges WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE edges SET weight = weight + 1 WHERE id = ?').run(id);
  } else {
    db.prepare(
      'INSERT INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, projectId, fromId, toId, relation, 1.0, source, now);
  }
  return id;
}

function searchObservationsFts(db, projectId, query, topK = 10) {
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return [];
  const ftsQ = tokens.map((t) => `"${t}"`).join(' AND ');
  return db
    .prepare(
      `SELECT o.id AS obs_id, o.entity_id, o.text AS obs_text,
              e.name AS entity_name, e.type AS entity_type
       FROM observations_fts
       JOIN observations o ON o.id = observations_fts.id
       JOIN entities e ON e.id = o.entity_id
       WHERE observations_fts MATCH ? AND o.project_id = ?
       LIMIT ?`,
    )
    .all(ftsQ, projectId, topK);
}

function graphQuery(db, projectId, entityName, maxHops = 2) {
  const root = db
    .prepare('SELECT * FROM entities WHERE project_id = ? AND name LIKE ? LIMIT 1')
    .get(projectId, `%${entityName}%`);
  if (!root) return { nodes: [], edges: [] };

  const nodeMap = new Map([[root.id, root]]);
  const edgeMap = new Map();
  let frontier = [root.id];
  const edgeStmt = db.prepare(
    `SELECT * FROM edges WHERE project_id = ? AND from_id = ?
     UNION ALL
     SELECT * FROM edges WHERE project_id = ? AND to_id = ?`,
  );
  const entityStmt = db.prepare('SELECT * FROM entities WHERE id = ?');

  for (let hop = 0; hop < maxHops; hop++) {
    const next = [];
    for (const eid of frontier) {
      const edgeRows = edgeStmt.all(projectId, eid, projectId, eid);
      for (const e of edgeRows) {
        if (!edgeMap.has(e.id)) edgeMap.set(e.id, e);
        const neighborId = e.from_id === eid ? e.to_id : e.from_id;
        if (!nodeMap.has(neighborId)) {
          const neighbor = entityStmt.get(neighborId);
          if (neighbor) {
            nodeMap.set(neighborId, neighbor);
            next.push(neighborId);
          }
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

function expandContext(db, projectId, queryKeywords, topChunkIds) {
  const result = new Set();
  const topChunkSet = new Set(topChunkIds);
  const seedEntityIds = new Set();

  const entityByLike = db.prepare('SELECT id FROM entities WHERE project_id = ? AND name LIKE ?');
  for (const kw of queryKeywords) {
    const rows = entityByLike.all(projectId, `%${kw}%`);
    for (const r of rows) seedEntityIds.add(r.id);
  }
  const entityByChunk = db.prepare(
    `SELECT id FROM entities WHERE project_id = ?
     AND EXISTS (SELECT 1 FROM json_each(chunk_ids) AS j WHERE j.value = ?)`,
  );
  for (const chunkId of topChunkIds) {
    const rows = entityByChunk.all(projectId, chunkId);
    for (const r of rows) seedEntityIds.add(r.id);
  }
  if (seedEntityIds.size === 0) return result;

  const visited = new Set(seedEntityIds);
  let frontier = [...seedEntityIds];
  const neighborStmt = db.prepare(
    `SELECT to_id AS neighbor_id FROM edges WHERE project_id = ? AND from_id = ?
     UNION
     SELECT from_id AS neighbor_id FROM edges WHERE project_id = ? AND to_id = ?`,
  );
  for (let hop = 0; hop < 2; hop++) {
    const next = [];
    for (const eid of frontier) {
      const neighbors = neighborStmt.all(projectId, eid, projectId, eid);
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
      for (const cid of parseJsonArray(entity.chunk_ids)) {
        if (!topChunkSet.has(cid)) result.add(cid);
      }
    }
  }
  return result;
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

test('entity creation: file, symbol, and concept types stored correctly', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'handles JWT verification', 'chunk-1');
  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'class that wraps auth logic', 'chunk-1');
  assertEntityWithObservation(db, proj, 'JWT', 'concept', 'token format used for auth', 'chunk-1');

  const rows = db.prepare('SELECT name, type FROM entities WHERE project_id = ?').all(proj);
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('auth.ts'));
  assert.ok(names.includes('AuthService'));
  assert.ok(names.includes('JWT'));

  const types = Object.fromEntries(rows.map((r) => [r.name, r.type]));
  assert.equal(types['auth.ts'], 'file');
  assert.equal(types['AuthService'], 'symbol');
  assert.equal(types['JWT'], 'concept');
});

test('entity chunk_ids track which chunks reference them', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'first mention', 'chunk-1');
  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'second mention', 'chunk-2');

  const row = db
    .prepare('SELECT chunk_ids FROM entities WHERE project_id = ? AND name = ?')
    .get(proj, 'auth.ts');
  const ids = parseJsonArray(row.chunk_ids);
  assert.ok(ids.includes('chunk-1'));
  assert.ok(ids.includes('chunk-2'));
  assert.equal(ids.length, 2);
});

test('entity is idempotent — same chunk registered twice does not duplicate chunk_ids', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'initial obs', 'chunk-1');
  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'same chunk again', 'chunk-1');

  const row = db
    .prepare('SELECT chunk_ids FROM entities WHERE project_id = ? AND name = ?')
    .get(proj, 'auth.ts');
  assert.equal(parseJsonArray(row.chunk_ids).length, 1);
});

test('observation attached to entity is searchable via FTS', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'validates JWT tokens using RS256', 'chunk-1');

  const hits = searchObservationsFts(db, proj, 'JWT tokens');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].obs_text.includes('JWT'));
  assert.equal(hits[0].entity_name, 'auth.ts');
  assert.equal(hits[0].entity_type, 'file');
});

test('observation search respects project isolation', () => {
  const db = openDb();

  assertEntityWithObservation(db, 'proj-A', 'auth.ts', 'file', 'project A auth logic', 'chunk-a');
  assertEntityWithObservation(db, 'proj-B', 'auth.ts', 'file', 'project B auth logic', 'chunk-b');

  const hitsA = searchObservationsFts(db, 'proj-A', 'auth logic');
  const hitsB = searchObservationsFts(db, 'proj-B', 'auth logic');

  assert.equal(hitsA.length, 1);
  assert.equal(hitsB.length, 1);
  assert.ok(hitsA[0].obs_text.includes('project A'));
  assert.ok(hitsB[0].obs_text.includes('project B'));
});

test('observation is idempotent — inserting same text twice does not duplicate', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'handles JWT', 'chunk-1');
  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'handles JWT', 'chunk-1');

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM observations WHERE project_id = ? AND text = 'handles JWT'")
    .get(proj).c;
  assert.equal(count, 1);
});

test('observation stores source_chunk_id for traceability', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'uses bcrypt for hashing', 'chunk-42');

  const entId = entityId(proj, 'auth.ts', 'file');
  const row = db.prepare('SELECT source_chunk_id FROM observations WHERE entity_id = ?').get(entId);
  assert.equal(row.source_chunk_id, 'chunk-42');
});

test('linking: edge created between two entities', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service class', 'chunk-1');
  assertEntityWithObservation(db, proj, 'TokenValidator', 'symbol', 'validates tokens', 'chunk-1');

  const fromId = entityId(proj, 'AuthService', 'symbol');
  const toId = entityId(proj, 'TokenValidator', 'symbol');
  upsertEdge(db, proj, fromId, toId, 'depends_on');

  const edge = db.prepare('SELECT * FROM edges WHERE project_id = ?').get(proj);
  assert.equal(edge.from_id, fromId);
  assert.equal(edge.to_id, toId);
  assert.equal(edge.relation, 'depends_on');
  assert.equal(edge.weight, 1.0);
});

test('linking: edge weight increments on repeated co-mention', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-1');
  assertEntityWithObservation(db, proj, 'TokenValidator', 'symbol', 'token validator', 'chunk-1');

  const fromId = entityId(proj, 'AuthService', 'symbol');
  const toId = entityId(proj, 'TokenValidator', 'symbol');
  upsertEdge(db, proj, fromId, toId, 'related_to');
  upsertEdge(db, proj, fromId, toId, 'related_to');

  const edge = db.prepare('SELECT weight FROM edges WHERE project_id = ?').get(proj);
  assert.equal(edge.weight, 2.0);
});

test('linking: self-edge is not created', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-1');
  const id = entityId(proj, 'AuthService', 'symbol');

  upsertEdge(db, proj, id, id, 'related_to'); // guard rejects this silently

  const count = db
    .prepare('SELECT COUNT(*) AS c FROM edges WHERE project_id = ? AND from_id = to_id')
    .get(proj).c;
  assert.equal(count, 0);
});

test('graph query: returns root node for known entity', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-1');

  const { nodes, edges } = graphQuery(db, proj, 'AuthService');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'AuthService');
  assert.equal(edges.length, 0);
});

test('graph query: returns empty for unknown entity', () => {
  const db = openDb();
  const { nodes, edges } = graphQuery(db, 'smoke-proj', 'NonExistent');
  assert.equal(nodes.length, 0);
  assert.equal(edges.length, 0);
});

test('graph query: traverses one hop to connected entity', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-1');
  assertEntityWithObservation(db, proj, 'TokenValidator', 'symbol', 'token validator', 'chunk-2');

  const fromId = entityId(proj, 'AuthService', 'symbol');
  const toId = entityId(proj, 'TokenValidator', 'symbol');
  upsertEdge(db, proj, fromId, toId, 'depends_on');

  const { nodes, edges } = graphQuery(db, proj, 'AuthService', 1);
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  const names = nodes.map((n) => n.name);
  assert.ok(names.includes('AuthService'));
  assert.ok(names.includes('TokenValidator'));
});

test('graph query: multi-hop traversal reaches distant nodes', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  // Chain: AuthService → TokenValidator → JwtDecoder
  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-1');
  assertEntityWithObservation(db, proj, 'TokenValidator', 'symbol', 'token validator', 'chunk-2');
  assertEntityWithObservation(db, proj, 'JwtDecoder', 'symbol', 'jwt decoder', 'chunk-3');

  const authId = entityId(proj, 'AuthService', 'symbol');
  const validId = entityId(proj, 'TokenValidator', 'symbol');
  const jwtId = entityId(proj, 'JwtDecoder', 'symbol');
  upsertEdge(db, proj, authId, validId, 'depends_on');
  upsertEdge(db, proj, validId, jwtId, 'depends_on');

  const { nodes } = graphQuery(db, proj, 'AuthService', 2);
  const names = nodes.map((n) => n.name);
  assert.ok(names.includes('AuthService'));
  assert.ok(names.includes('TokenValidator'));
  assert.ok(names.includes('JwtDecoder'));
});

test('graph query: partial name match works', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-1');

  const { nodes } = graphQuery(db, proj, 'Auth');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'AuthService');
});

test('context expansion: finds extra chunk IDs via entity graph', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-auth');
  assertEntityWithObservation(db, proj, 'TokenValidator', 'symbol', 'token validator', 'chunk-token');

  const authId = entityId(proj, 'AuthService', 'symbol');
  const tokenId = entityId(proj, 'TokenValidator', 'symbol');
  upsertEdge(db, proj, authId, tokenId, 'related_to');

  // Start with chunk-auth as a top result; expandContext should find chunk-token via graph
  const extra = expandContext(db, proj, ['auth'], ['chunk-auth']);
  assert.ok(extra.has('chunk-token'));
});

test('context expansion: excludes topChunkIds from result', () => {
  const db = openDb();
  const proj = 'smoke-proj';

  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'auth service', 'chunk-auth');

  const extra = expandContext(db, proj, ['auth'], ['chunk-auth']);
  assert.ok(!extra.has('chunk-auth'));
});

test('end-to-end: chunk → entities → observations → links → graph query → observation search', () => {
  const db = openDb();
  const proj = 'e2e-proj';

  // Step 1: register a chunk
  const chunkId = 'chunk-e2e-1';

  // Step 2: extract and register entities from chunk text
  assertEntityWithObservation(db, proj, 'auth.ts', 'file', 'core authentication module', chunkId);
  assertEntityWithObservation(db, proj, 'AuthService', 'symbol', 'service class in auth.ts', chunkId);
  assertEntityWithObservation(db, proj, 'JWT', 'concept', 'token format used by AuthService', chunkId);

  // Step 3: link entities
  const fileId = entityId(proj, 'auth.ts', 'file');
  const symbolId = entityId(proj, 'AuthService', 'symbol');
  const conceptId = entityId(proj, 'JWT', 'concept');
  upsertEdge(db, proj, symbolId, fileId, 'modifies');
  upsertEdge(db, proj, symbolId, conceptId, 'related_to');

  // Step 4: verify entity count
  const entityCount = db.prepare('SELECT COUNT(*) AS c FROM entities WHERE project_id = ?').get(proj).c;
  assert.equal(entityCount, 3);

  // Step 5: verify observation count (one per assertEntityWithObservation call)
  const obsCount = db.prepare('SELECT COUNT(*) AS c FROM observations WHERE project_id = ?').get(proj).c;
  assert.equal(obsCount, 3);

  // Step 6: verify edge count
  const edgeCount = db.prepare('SELECT COUNT(*) AS c FROM edges WHERE project_id = ?').get(proj).c;
  assert.equal(edgeCount, 2);

  // Step 7: graph query from AuthService reaches auth.ts and JWT
  const { nodes } = graphQuery(db, proj, 'AuthService', 1);
  const names = nodes.map((n) => n.name);
  assert.ok(names.includes('auth.ts'));
  assert.ok(names.includes('JWT'));

  // Step 8: observation search finds the right entity
  const hits = searchObservationsFts(db, proj, 'authentication module');
  assert.ok(hits.length > 0);
  assert.equal(hits[0].entity_name, 'auth.ts');

  // Step 9: context expansion from chunk retrieves neighbor chunks (AuthService → JWT)
  assertEntityWithObservation(db, proj, 'JWT', 'concept', 'second JWT mention', 'chunk-e2e-2');
  const extra = expandContext(db, proj, ['jwt'], ['chunk-e2e-1']);
  assert.ok(extra.has('chunk-e2e-2'));
});
