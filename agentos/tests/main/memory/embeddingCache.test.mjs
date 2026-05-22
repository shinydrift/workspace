/**
 * Tests for memory/embeddingCache.ts — cache I/O and pruning logic.
 * Uses node:sqlite (DatabaseSync) to avoid Electron ABI issues.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// ── Schema (inlined from db.ts) ───────────────────────────────────────────────

const SCHEMA_SQL = `
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
`;

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Inlined from embeddingCache.ts ────────────────────────────────────────────

const EMBEDDING_BATCH_SIZE = 16;
const EMBEDDING_CACHE_MAX_ENTRIES = 10_000;

function loadEmbeddingCache(db, provider, hashes) {
  const result = new Map();
  if (hashes.length === 0) return result;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
    const batch = hashes.slice(i, i + CHUNK_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT hash, embedding FROM embedding_cache
         WHERE provider = ? AND model = ? AND provider_key = ? AND hash IN (${placeholders})`
      )
      .all(provider.id, provider.model, provider.providerKey, ...batch);
    for (const row of rows) {
      try {
        result.set(row.hash, JSON.parse(row.embedding));
      } catch {
        /* skip */
      }
    }
  }
  return result;
}

function upsertEmbeddingCache(db, provider, entries) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO embedding_cache
     (provider, model, provider_key, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  for (const { hash, embedding } of entries) {
    stmt.run(provider.id, provider.model, provider.providerKey, hash, JSON.stringify(embedding), embedding.length, now);
  }
}

function pruneEmbeddingCache(db, maxEntries = EMBEDDING_CACHE_MAX_ENTRIES) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM embedding_cache').get().n;
  if (count <= maxEntries) return;
  db.prepare(
    `DELETE FROM embedding_cache WHERE rowid NOT IN (
       SELECT rowid FROM embedding_cache ORDER BY updated_at DESC LIMIT ?)`
  ).run(maxEntries);
}

// ── loadEmbeddingCache ────────────────────────────────────────────────────────

test('loadEmbeddingCache returns empty map for empty hashes', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k1' };
  const result = loadEmbeddingCache(db, provider, []);
  assert.equal(result.size, 0);
  db.close();
});

test('loadEmbeddingCache returns empty map when nothing cached', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k1' };
  const result = loadEmbeddingCache(db, provider, ['hash1']);
  assert.equal(result.size, 0);
  db.close();
});

test('loadEmbeddingCache retrieves previously stored embeddings', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k1' };
  upsertEmbeddingCache(db, provider, [{ hash: 'h1', embedding: [0.1, 0.2, 0.3] }]);
  const result = loadEmbeddingCache(db, provider, ['h1']);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('h1'), [0.1, 0.2, 0.3]);
  db.close();
});

test('loadEmbeddingCache only returns matching provider entries', () => {
  const db = openDb();
  const p1 = { id: 'local', model: 'test', providerKey: 'k1' };
  const p2 = { id: 'openai', model: 'ada', providerKey: 'k2' };
  upsertEmbeddingCache(db, p1, [{ hash: 'h1', embedding: [1, 2] }]);
  upsertEmbeddingCache(db, p2, [{ hash: 'h1', embedding: [3, 4] }]);
  const result1 = loadEmbeddingCache(db, p1, ['h1']);
  assert.deepEqual(result1.get('h1'), [1, 2]);
  const result2 = loadEmbeddingCache(db, p2, ['h1']);
  assert.deepEqual(result2.get('h1'), [3, 4]);
  db.close();
});

test('loadEmbeddingCache handles multiple hashes', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k' };
  upsertEmbeddingCache(db, provider, [
    { hash: 'h1', embedding: [1] },
    { hash: 'h2', embedding: [2] },
    { hash: 'h3', embedding: [3] },
  ]);
  const result = loadEmbeddingCache(db, provider, ['h1', 'h3']);
  assert.equal(result.size, 2);
  assert.ok(result.has('h1'));
  assert.ok(result.has('h3'));
  assert.ok(!result.has('h2'));
  db.close();
});

// ── upsertEmbeddingCache ──────────────────────────────────────────────────────

test('upsertEmbeddingCache inserts new entry', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k' };
  upsertEmbeddingCache(db, provider, [{ hash: 'h1', embedding: [0.5] }]);
  const row = db.prepare('SELECT * FROM embedding_cache WHERE hash = ?').get('h1');
  assert.ok(row);
  assert.equal(row.provider, 'local');
  assert.equal(row.model, 'test');
  db.close();
});

test('upsertEmbeddingCache stores dims as embedding length', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k' };
  upsertEmbeddingCache(db, provider, [{ hash: 'h1', embedding: [0.1, 0.2, 0.3] }]);
  const row = db.prepare('SELECT dims FROM embedding_cache WHERE hash = ?').get('h1');
  assert.equal(row.dims, 3);
  db.close();
});

test('upsertEmbeddingCache replaces existing entry for same key', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k' };
  upsertEmbeddingCache(db, provider, [{ hash: 'h1', embedding: [1, 2] }]);
  upsertEmbeddingCache(db, provider, [{ hash: 'h1', embedding: [9, 8, 7] }]);
  const result = loadEmbeddingCache(db, provider, ['h1']);
  assert.deepEqual(result.get('h1'), [9, 8, 7]);
  db.close();
});

test('upsertEmbeddingCache handles empty entries list gracefully', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k' };
  assert.doesNotThrow(() => upsertEmbeddingCache(db, provider, []));
  db.close();
});

// ── pruneEmbeddingCache ───────────────────────────────────────────────────────

test('pruneEmbeddingCache does nothing when under limit', () => {
  const db = openDb();
  const provider = { id: 'local', model: 'test', providerKey: 'k' };
  upsertEmbeddingCache(db, provider, [
    { hash: 'h1', embedding: [1] },
    { hash: 'h2', embedding: [2] },
  ]);
  pruneEmbeddingCache(db, 5);
  const count = db.prepare('SELECT COUNT(*) AS n FROM embedding_cache').get().n;
  assert.equal(count, 2);
  db.close();
});

test('pruneEmbeddingCache removes oldest entries to meet limit', () => {
  const db = openDb();
  // Insert 5 entries with different updated_at timestamps
  const stmt = db.prepare(
    'INSERT INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (let i = 1; i <= 5; i++) {
    stmt.run('local', 'test', 'k', `h${i}`, '[]', 0, i * 1000);
  }
  pruneEmbeddingCache(db, 3);
  const count = db.prepare('SELECT COUNT(*) AS n FROM embedding_cache').get().n;
  assert.equal(count, 3);
  // Oldest (h1=1000, h2=2000) should be removed; newest (h3,h4,h5) kept
  const remaining = db.prepare('SELECT hash FROM embedding_cache ORDER BY updated_at').all();
  const hashes = remaining.map((r) => r.hash);
  assert.ok(!hashes.includes('h1'));
  assert.ok(!hashes.includes('h2'));
  assert.ok(hashes.includes('h5'));
  db.close();
});

test('pruneEmbeddingCache with exact limit does nothing', () => {
  const db = openDb();
  const stmt = db.prepare(
    'INSERT INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (let i = 1; i <= 3; i++) {
    stmt.run('local', 'test', 'k', `h${i}`, '[]', 0, i * 1000);
  }
  pruneEmbeddingCache(db, 3);
  const count = db.prepare('SELECT COUNT(*) AS n FROM embedding_cache').get().n;
  assert.equal(count, 3);
  db.close();
});

// ── getProvider cache key ─────────────────────────────────────────────────────

test('provider cache key is stable for same settings', () => {
  const makeKey = (s) => JSON.stringify({
    p: s.embeddingProvider,
    m: s.embeddingModel,
    l: s.localModelPath,
    k: s.apiKeys,
  });
  const key1 = makeKey({ embeddingProvider: 'local', embeddingModel: 'model1', localModelPath: null });
  const key2 = makeKey({ embeddingProvider: 'local', embeddingModel: 'model1', localModelPath: null });
  assert.equal(key1, key2);
});

test('provider cache key differs when provider changes', () => {
  const makeKey = (s) => JSON.stringify({
    p: s.embeddingProvider,
    m: s.embeddingModel,
    l: s.localModelPath,
    k: s.apiKeys,
  });
  const key1 = makeKey({ embeddingProvider: 'local', embeddingModel: 'model1' });
  const key2 = makeKey({ embeddingProvider: 'openai', embeddingModel: 'model1' });
  assert.notEqual(key1, key2);
});
