/**
 * Smoke test for sqlite-vec cosine similarity correctness.
 * Gracefully skips if better-sqlite3 or sqlite-vec are not loadable in this
 * environment (both are compiled for Electron's ABI, not system Node.js).
 * Run this manually or in Electron context before bumping sqlite-vec version.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Vectors need not be unit-normalised — cosine distance is direction-only.
const toF32 = (arr) => Buffer.from(new Float32Array(arr).buffer);

function loadDb() {
  try {
    const BetterSQLite3 = require('better-sqlite3');
    const db = new BetterSQLite3(':memory:');
    try {
      require('sqlite-vec').load(db);
      return db;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

test('sqlite-vec cosine similarity returns expected result', () => {
  const db = loadDb();
  if (!db) return; // Electron ABI required — graceful skip in standard Node.js

  db.exec('CREATE VIRTUAL TABLE vss USING vec0(id TEXT, embedding float[3])');

  db.prepare('INSERT OR REPLACE INTO vss (id, embedding) VALUES (?, vec_f32(?))').run('a', toF32([1, 0, 0]));
  db.prepare('INSERT OR REPLACE INTO vss (id, embedding) VALUES (?, vec_f32(?))').run('b', toF32([0, 1, 0]));

  const result = db
    .prepare('SELECT vec_distance_cosine(embedding, vec_f32(?)) AS dist FROM vss WHERE id = ?')
    .get(toF32([1, 0, 0]), 'a');

  // exact same vector → cosine distance 0
  assert.strictEqual(result.dist, 0);

  const result2 = db
    .prepare('SELECT vec_distance_cosine(embedding, vec_f32(?)) AS dist FROM vss WHERE id = ?')
    .get(toF32([1, 0, 0]), 'b');

  // orthogonal vectors → cosine distance 1
  assert.strictEqual(result2.dist, 1);
});

test('sqlite-vec KNN MATCH syntax returns nearest neighbours', () => {
  const db = loadDb();
  if (!db) return; // Electron ABI required — graceful skip in standard Node.js

  db.exec('CREATE VIRTUAL TABLE knn_test USING vec0(id TEXT, embedding float[3])');

  // Five vectors near [1,0,0], one far — KNN(k=5) must exclude the far one.
  const vectors = [
    ['a', [1.0, 0.0, 0.0]],
    ['b', [0.9, 0.1, 0.0]],
    ['c', [0.8, 0.2, 0.0]],
    ['d', [0.7, 0.3, 0.0]],
    ['e', [0.6, 0.4, 0.0]],
    ['f', [0.0, 0.0, 1.0]],
  ];
  const insert = db.prepare('INSERT OR REPLACE INTO knn_test (id, embedding) VALUES (?, vec_f32(?))');
  for (const [id, vec] of vectors) insert.run(id, toF32(vec));

  const query = toF32([1, 0, 0]);

  // KNN via MATCH syntax (index path)
  const knnIds = db
    .prepare('SELECT id FROM knn_test WHERE embedding MATCH vec_f32(?) AND k = 5')
    .all(query)
    .map((r) => r.id)
    .sort();

  // Brute-force reference: ORDER BY cosine distance
  const bruteIds = db
    .prepare('SELECT id FROM knn_test ORDER BY vec_distance_cosine(embedding, vec_f32(?)) ASC LIMIT 5')
    .all(query)
    .map((r) => r.id)
    .sort();

  assert.deepStrictEqual(knnIds, bruteIds);
  assert.ok(!knnIds.includes('f'), 'orthogonal vector should not be in top-5 KNN');
});
