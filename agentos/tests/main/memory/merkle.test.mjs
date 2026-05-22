/**
 * Tests for HS-08 — Merkle DAG for file-backed memory.
 * Covers: content-addressed chunk IDs (Phase 1), entity content_hash (Phase 2),
 * and Merkle root + integrity (Phase 3).
 * Uses node:sqlite (DatabaseSync) to avoid Electron ABI issues.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ── Schema (inlined with HS-08 columns) ──────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
  context_header TEXT NOT NULL DEFAULT '',
  llm_graph_indexed INTEGER NOT NULL DEFAULT 0,
  project_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  chunk_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  content_hash TEXT
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

function memoryChunkId(embedText) {
  return 'memory:' + hashText(embedText);
}

function entityId(projectId, name, type) {
  return hashText(`${projectId}:${type}:${name}`);
}

function edgeId(projectId, fromId, toId, relation) {
  return hashText(`${projectId}:${fromId}:${toId}:${relation}`);
}

/** Upsert a chunk with content-addressed ID and project_ids tracking. */
function upsertMemoryChunk(db, projectId, embedText, path, startLine, endLine) {
  const id = memoryChunkId(embedText);
  const hash = hashText(embedText);
  const now = Date.now();
  const existing = db.prepare('SELECT id, project_ids FROM chunks WHERE id = ?').get(id);
  if (existing) {
    const ids = JSON.parse(existing.project_ids);
    if (!ids.includes(projectId)) {
      db.prepare('UPDATE chunks SET project_ids = ? WHERE id = ?').run(
        JSON.stringify([...ids, projectId]),
        id,
      );
    }
    return id;
  }
  db.prepare(
    `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, summary, embedding, updated_at, project_ids)
     VALUES (?, ?, 'memory', ?, ?, ?, '__none__', ?, '', '[]', ?, ?)`,
  ).run(id, path, startLine, endLine, hash, embedText, now, JSON.stringify([projectId]));
  return id;
}

/** Remove a project from a chunk's project_ids; delete row when empty. */
function removeProjectFromChunk(db, chunkId, projectId) {
  db.prepare(`
    UPDATE chunks
    SET project_ids = (
      SELECT json_group_array(value)
      FROM json_each(project_ids)
      WHERE value != ?
    )
    WHERE id = ?
  `).run(projectId, chunkId);
  db.prepare(`DELETE FROM chunks WHERE id = ? AND json_array_length(project_ids) = 0`).run(chunkId);
}

/** Compute entity content_hash from its fields + observation texts + child content_hashes. */
function computeEntityContentHash(db, entityId_, projectId, visited = new Set()) {
  if (visited.has(entityId_)) return null;
  visited.add(entityId_);

  const entity = db.prepare('SELECT name, type, aliases FROM entities WHERE id = ?').get(entityId_);
  if (!entity) return null;

  const obsRows = db
    .prepare('SELECT text FROM observations WHERE entity_id = ? AND project_id = ? ORDER BY text ASC')
    .all(entityId_, projectId);
  const obsList = obsRows.map((r) => r.text).sort();

  const childEdges = db
    .prepare('SELECT to_id FROM edges WHERE project_id = ? AND from_id = ?')
    .all(projectId, entityId_);
  const childHashes = [];
  for (const { to_id } of childEdges) {
    const childRow = db.prepare('SELECT content_hash FROM entities WHERE id = ?').get(to_id);
    if (childRow && childRow.content_hash !== null && childRow.content_hash !== undefined) {
      childHashes.push(childRow.content_hash);
    }
  }
  childHashes.sort();

  const input = JSON.stringify({
    name: entity.name,
    type: entity.type,
    aliases: entity.aliases,
    observations: obsList,
    childHashes,
  });
  return hashText(input);
}

/** Propagate content_hash upward from entityId, max 3 hops; mark dirty (NULL) beyond. */
function propagateContentHash(db, startEntityId, projectId) {
  const MAX_HOPS = 3;
  const updated = new Set(); // tracks which entities have been updated this pass

  function updateEntity(eid, hop) {
    if (updated.has(eid)) return;
    updated.add(eid);

    if (hop > MAX_HOPS) {
      db.prepare('UPDATE entities SET content_hash = NULL WHERE id = ?').run(eid);
      return;
    }

    // Use a fresh cycle-guard set for each entity's hash computation
    const hash = computeEntityContentHash(db, eid, projectId, new Set());
    if (hash !== null) {
      db.prepare('UPDATE entities SET content_hash = ? WHERE id = ?').run(hash, eid);
    }

    const parents = db
      .prepare('SELECT from_id FROM edges WHERE project_id = ? AND to_id = ?')
      .all(projectId, eid);
    for (const { from_id } of parents) {
      updateEntity(from_id, hop + 1);
    }
  }

  updateEntity(startEntityId, 0);
}

/** Compute the Merkle root for a project: sha256 of sorted chunk IDs + sorted entity hashes. */
function computeMerkleRoot(db, projectId) {
  const chunkIds = db
    .prepare(
      `SELECT id FROM chunks WHERE EXISTS (SELECT 1 FROM json_each(project_ids) WHERE value = ?) ORDER BY id ASC`,
    )
    .all(projectId)
    .map((r) => r.id);

  const entityHashes = db
    .prepare(
      'SELECT content_hash FROM entities WHERE project_id = ? AND content_hash IS NOT NULL ORDER BY content_hash ASC',
    )
    .all(projectId)
    .map((r) => r.content_hash);

  return hashText(JSON.stringify([chunkIds, entityHashes]));
}

/** Persist merkle root and clear dirty flag. */
function persistMerkleRoot(db, projectId) {
  const root = computeMerkleRoot(db, projectId);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_' || ?, ?)").run(projectId, root);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_dirty_' || ?, 'false')").run(projectId);
  return root;
}

/** Mark merkle root dirty (called after writes). */
function markMerkleRootDirty(db, projectId) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_dirty_' || ?, 'true')").run(projectId);
}

/** Verify integrity: recompute root and compare to stored. */
function verifyIntegrity(db, projectId) {
  const dirtyRow = db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_dirty_' || ?").get(projectId);
  const storedRow = db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_' || ?").get(projectId);
  if (!storedRow) return false;
  if (dirtyRow?.value === 'true') return false;
  const recomputed = computeMerkleRoot(db, projectId);
  const matches = recomputed === storedRow.value;
  if (matches) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_dirty_' || ?, 'false')").run(projectId);
  }
  return matches;
}

// ── Phase 1: Content-addressed chunk IDs ─────────────────────────────────────

test('memoryChunkId returns memory: prefix + 16-char hash', () => {
  const id = memoryChunkId('hello world');
  assert.ok(id.startsWith('memory:'));
  assert.equal(id.slice('memory:'.length).length, 16);
  assert.match(id, /^memory:[0-9a-f]{16}$/);
});

test('memoryChunkId is deterministic', () => {
  assert.equal(memoryChunkId('same text'), memoryChunkId('same text'));
});

test('memoryChunkId differs for different content', () => {
  assert.notEqual(memoryChunkId('foo'), memoryChunkId('bar'));
});

test('same content in two files produces one chunk row with both project IDs', () => {
  const db = openDb();
  const content = 'identical content across both projects';

  upsertMemoryChunk(db, 'projectA', content, 'memory/shared.md', 1, 5);
  upsertMemoryChunk(db, 'projectB', content, 'memory/shared.md', 1, 5);

  const rows = db.prepare('SELECT * FROM chunks WHERE id = ?').all(memoryChunkId(content));
  assert.equal(rows.length, 1, 'one chunk row');
  const ids = JSON.parse(rows[0].project_ids);
  assert.ok(ids.includes('projectA'));
  assert.ok(ids.includes('projectB'));
});

test('upsert of existing chunk does not duplicate project ID in project_ids', () => {
  const db = openDb();
  upsertMemoryChunk(db, 'projectA', 'some text', 'MEMORY.md', 1, 3);
  upsertMemoryChunk(db, 'projectA', 'some text', 'MEMORY.md', 1, 3);

  const row = db.prepare('SELECT project_ids FROM chunks WHERE id = ?').get(memoryChunkId('some text'));
  const ids = JSON.parse(row.project_ids);
  assert.equal(ids.filter((x) => x === 'projectA').length, 1);
});

test('removing projectA from shared chunk leaves projectB; second removal deletes row', () => {
  const db = openDb();
  const content = 'shared content';
  const id = memoryChunkId(content);

  upsertMemoryChunk(db, 'projectA', content, 'MEMORY.md', 1, 3);
  upsertMemoryChunk(db, 'projectB', content, 'MEMORY.md', 1, 3);

  removeProjectFromChunk(db, id, 'projectA');
  const afterA = db.prepare('SELECT project_ids FROM chunks WHERE id = ?').get(id);
  assert.ok(afterA, 'chunk row still exists after removing projectA');
  const idsAfterA = JSON.parse(afterA.project_ids);
  assert.ok(!idsAfterA.includes('projectA'));
  assert.ok(idsAfterA.includes('projectB'));

  removeProjectFromChunk(db, id, 'projectB');
  const afterB = db.prepare('SELECT id FROM chunks WHERE id = ?').get(id);
  assert.equal(afterB, undefined, 'chunk row removed when project_ids is empty');
});

// ── Phase 2: Entity content_hash ──────────────────────────────────────────────

test('computeEntityContentHash returns 16-char hex string', () => {
  const db = openDb();
  const pid = 'proj1';
  const now = Date.now();
  const eid = entityId(pid, 'MyEntity', 'concept');
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eid, pid, 'MyEntity', 'concept', '[]', '[]', now, now,
  );
  const hash = computeEntityContentHash(db, eid, pid);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test('entity with circular edge does not cause infinite recursion', () => {
  const db = openDb();
  const pid = 'proj1';
  const now = Date.now();

  const eidA = entityId(pid, 'A', 'concept');
  const eidB = entityId(pid, 'B', 'concept');
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eidA, pid, 'A', 'concept', '[]', '[]', now, now,
  );
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eidB, pid, 'B', 'concept', '[]', '[]', now, now,
  );

  const eAB = edgeId(pid, eidA, eidB, 'related_to');
  const eBA = edgeId(pid, eidB, eidA, 'related_to');
  db.prepare('INSERT INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eAB, pid, eidA, eidB, 'related_to', 1.0, '', now,
  );
  db.prepare('INSERT INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eBA, pid, eidB, eidA, 'related_to', 1.0, '', now,
  );

  assert.doesNotThrow(() => {
    computeEntityContentHash(db, eidA, pid);
  });
});

test('adding observation changes leaf content_hash and propagates to parent', () => {
  const db = openDb();
  const pid = 'proj1';
  const now = Date.now();

  const leafId = entityId(pid, 'leaf', 'concept');
  const parentId = entityId(pid, 'parent', 'concept');
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at, content_hash) VALUES (?,?,?,?,?,?,?,?,NULL)').run(
    leafId, pid, 'leaf', 'concept', '[]', '[]', now, now,
  );
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at, content_hash) VALUES (?,?,?,?,?,?,?,?,NULL)').run(
    parentId, pid, 'parent', 'concept', '[]', '[]', now, now,
  );
  const eParentLeaf = edgeId(pid, parentId, leafId, 'related_to');
  db.prepare('INSERT INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eParentLeaf, pid, parentId, leafId, 'related_to', 1.0, '', now,
  );

  // Initial hashes
  const h1Leaf = computeEntityContentHash(db, leafId, pid);
  db.prepare('UPDATE entities SET content_hash = ? WHERE id = ?').run(h1Leaf, leafId);
  propagateContentHash(db, leafId, pid);

  const hashBefore = db.prepare('SELECT content_hash FROM entities WHERE id = ?').get(leafId).content_hash;

  // Add observation to leaf
  const obsId = hashText(`${leafId}:new fact about leaf`);
  db.prepare('INSERT INTO observations (id, entity_id, project_id, text, created_at) VALUES (?,?,?,?,?)').run(
    obsId, leafId, pid, 'new fact about leaf', now,
  );

  // Recompute and propagate
  propagateContentHash(db, leafId, pid);

  const hashAfterLeaf = db.prepare('SELECT content_hash FROM entities WHERE id = ?').get(leafId).content_hash;
  const hashAfterParent = db.prepare('SELECT content_hash FROM entities WHERE id = ?').get(parentId).content_hash;

  assert.notEqual(hashAfterLeaf, hashBefore, 'leaf content_hash changed after observation');
  assert.ok(hashAfterParent !== null, 'parent content_hash recomputed');
});

test('entity beyond 3 hops is marked dirty (NULL) after propagation', () => {
  const db = openDb();
  const pid = 'proj1';
  const now = Date.now();

  // Chain: leaf → p1 → p2 → p3 → p4 (hop 4 from leaf, should be dirty)
  const names = ['leaf', 'p1', 'p2', 'p3', 'p4'];
  const eids = names.map((n) => entityId(pid, n, 'concept'));
  for (const [i, eid] of eids.entries()) {
    db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at, content_hash) VALUES (?,?,?,?,?,?,?,?,NULL)').run(
      eid, pid, names[i], 'concept', '[]', '[]', now, now,
    );
  }
  // chain edges: each points leaf→p1→p2→p3→p4 (parent has edge to child)
  for (let i = 1; i < eids.length; i++) {
    const eid = edgeId(pid, eids[i], eids[i - 1], 'related_to');
    db.prepare('INSERT INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      eid, pid, eids[i], eids[i - 1], 'related_to', 1.0, '', now,
    );
  }

  propagateContentHash(db, eids[0], pid); // start from leaf

  const p4Hash = db.prepare('SELECT content_hash FROM entities WHERE id = ?').get(eids[4]).content_hash;
  assert.equal(p4Hash, null, 'entity at hop 4 is marked dirty (NULL)');
});

test('child with content_hash NULL does not set parent to NULL', () => {
  const db = openDb();
  const pid = 'proj1';
  const now = Date.now();

  const childId = entityId(pid, 'child', 'concept');
  const parentId = entityId(pid, 'parent', 'concept');
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at, content_hash) VALUES (?,?,?,?,?,?,?,?,NULL)').run(
    childId, pid, 'child', 'concept', '[]', '[]', now, now,
  );
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at, content_hash) VALUES (?,?,?,?,?,?,?,?,NULL)').run(
    parentId, pid, 'parent', 'concept', '[]', '[]', now, now,
  );
  const eEdge = edgeId(pid, parentId, childId, 'related_to');
  db.prepare('INSERT INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    eEdge, pid, parentId, childId, 'related_to', 1.0, '', now,
  );

  // child stays NULL; compute parent hash
  const parentHash = computeEntityContentHash(db, parentId, pid);
  assert.ok(parentHash !== null, 'parent hash computed even when child is NULL');
  assert.match(parentHash, /^[0-9a-f]{16}$/);
});

// ── Phase 3: Merkle root + integrity ─────────────────────────────────────────

test('after a write, merkle_root_dirty is true; integrity check returns false without recompute', () => {
  const db = openDb();
  const pid = 'proj1';

  // Insert a chunk
  upsertMemoryChunk(db, pid, 'some memory content', 'MEMORY.md', 1, 3);
  markMerkleRootDirty(db, pid);

  const dirty = db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_dirty_' || ?").get(pid);
  assert.equal(dirty?.value, 'true');

  // No stored root → integrity is false
  const result = verifyIntegrity(db, pid);
  assert.equal(result, false);
});

test('after persistMerkleRoot, verifyIntegrity returns true', () => {
  const db = openDb();
  const pid = 'proj1';

  upsertMemoryChunk(db, pid, 'content alpha', 'MEMORY.md', 1, 3);
  upsertMemoryChunk(db, pid, 'content beta', 'memory/notes.md', 1, 5);
  const root = persistMerkleRoot(db, pid);

  assert.match(root, /^[0-9a-f]{16}$/);
  const verified = verifyIntegrity(db, pid);
  assert.equal(verified, true);

  const dirtyRow = db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_dirty_' || ?").get(pid);
  assert.equal(dirtyRow?.value, 'false');
});

test('modifying chunks after persistMerkleRoot causes verifyIntegrity to return false', () => {
  const db = openDb();
  const pid = 'proj1';

  upsertMemoryChunk(db, pid, 'stable content', 'MEMORY.md', 1, 3);
  persistMerkleRoot(db, pid);

  // Add a new chunk without updating root
  upsertMemoryChunk(db, pid, 'new content added later', 'memory/new.md', 1, 2);

  const verified = verifyIntegrity(db, pid);
  assert.equal(verified, false, 'root is stale after adding chunk');
});

test('fresh DB with no stored merkle_root returns integrity: false', () => {
  const db = openDb();
  const result = verifyIntegrity(db, 'fresh-project');
  assert.equal(result, false);
});

test('computeMerkleRoot is deterministic for same data', () => {
  const db1 = openDb();
  const db2 = openDb();
  const pid = 'proj1';

  for (const db of [db1, db2]) {
    upsertMemoryChunk(db, pid, 'chunk one', 'MEMORY.md', 1, 3);
    upsertMemoryChunk(db, pid, 'chunk two', 'memory/notes.md', 1, 5);
  }

  assert.equal(computeMerkleRoot(db1, pid), computeMerkleRoot(db2, pid));
});

test('merkle root changes when entity content_hash changes', () => {
  const db = openDb();
  const pid = 'proj1';
  const now = Date.now();

  const eid = entityId(pid, 'SomeEntity', 'concept');
  db.prepare('INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at, content_hash) VALUES (?,?,?,?,?,?,?,?,NULL)').run(
    eid, pid, 'SomeEntity', 'concept', '[]', '[]', now, now,
  );

  const root1 = computeMerkleRoot(db, pid);

  const hash = computeEntityContentHash(db, eid, pid);
  db.prepare('UPDATE entities SET content_hash = ? WHERE id = ?').run(hash, eid);

  const root2 = computeMerkleRoot(db, pid);
  assert.notEqual(root1, root2, 'root changes when an entity gains a content_hash');
});
