/**
 * Tests for memory/searchEngine.ts — createSnippet and loadProjectMemCfg logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// ── Inlined from searchEngine.ts ─────────────────────────────────────────────

function createSnippet(text, query) {
  const MAX = 300;
  if (!query || text.length <= MAX) return text.slice(0, MAX);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, MAX);
  const start = Math.max(0, idx - 80);
  return (start > 0 ? '…' : '') + text.slice(start, start + MAX);
}

// loadProjectMemCfg logic — inlined
const CFG_DEFAULTS = {
  decayEnabled: true,
  decayMinScore: 0,
  graphEnabled: true,
  graphBoost: 0.15,
  obsWeight: 0.15,
};

function loadProjectMemCfg(projectPath, defaultHalfLife) {
  const cfg = { ...CFG_DEFAULTS, halfLifeDays: defaultHalfLife };
  try {
    const cfgPath = path.join(projectPath, '.agentos', 'config.json');
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const mem = raw?.memory;
    if (mem) {
      if (typeof mem.decayEnabled === 'boolean') cfg.decayEnabled = mem.decayEnabled;
      if (typeof mem.decayHalfLifeDays === 'number') cfg.halfLifeDays = mem.decayHalfLifeDays;
      if (typeof mem.decayMinScore === 'number') cfg.decayMinScore = mem.decayMinScore;
      if (typeof mem.graphEnabled === 'boolean') cfg.graphEnabled = mem.graphEnabled;
      if (typeof mem.graphBoost === 'number') cfg.graphBoost = mem.graphBoost;
      if (typeof mem.obsWeight === 'number') cfg.obsWeight = mem.obsWeight;
    }
  } catch {
    /* no config — use defaults */
  }
  return cfg;
}

// ── createSnippet ─────────────────────────────────────────────────────────────

test('createSnippet returns text as-is when under 300 chars', () => {
  const text = 'short text';
  assert.equal(createSnippet(text, 'short'), 'short text');
});

test('createSnippet truncates long text with no query', () => {
  const text = 'x'.repeat(400);
  const snippet = createSnippet(text, '');
  assert.equal(snippet.length, 300);
});

test('createSnippet returns first 300 chars when query not found', () => {
  const text = 'a'.repeat(400);
  const snippet = createSnippet(text, 'zzz');
  assert.equal(snippet, 'a'.repeat(300));
});

test('createSnippet centers on query match', () => {
  const prefix = 'x'.repeat(200);
  const text = prefix + 'TARGET' + 'y'.repeat(200);
  const snippet = createSnippet(text, 'TARGET');
  assert.ok(snippet.includes('TARGET'));
});

test('createSnippet adds ellipsis when starting mid-text', () => {
  const prefix = 'x'.repeat(200);
  const text = prefix + 'TARGET' + 'y'.repeat(200);
  const snippet = createSnippet(text, 'TARGET');
  assert.ok(snippet.startsWith('…'));
});

test('createSnippet does not add ellipsis when match is near start', () => {
  const text = 'TARGET is here ' + 'x'.repeat(400);
  const snippet = createSnippet(text, 'TARGET');
  assert.ok(!snippet.startsWith('…'));
});

test('createSnippet is case-insensitive when finding match', () => {
  const text = 'The QUERY is here ' + 'x'.repeat(400);
  const snippet = createSnippet(text, 'query');
  assert.ok(snippet.toLowerCase().includes('query'));
});

test('createSnippet short text returned entirely even with query', () => {
  const text = 'hello world';
  assert.equal(createSnippet(text, 'hello'), 'hello world');
});

// ── loadProjectMemCfg ─────────────────────────────────────────────────────────

test('loadProjectMemCfg returns defaults when config file missing', () => {
  const cfg = loadProjectMemCfg('/no/such/path', 45);
  assert.equal(cfg.halfLifeDays, 45);
  assert.equal(cfg.decayEnabled, true);
  assert.equal(cfg.graphEnabled, true);
  assert.equal(cfg.graphBoost, 0.15);
  assert.equal(cfg.obsWeight, 0.15);
});

test('loadProjectMemCfg reads overrides from config file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-se-test-'));
  try {
    const arcDir = path.join(dir, '.agentos');
    fs.mkdirSync(arcDir);
    fs.writeFileSync(path.join(arcDir, 'config.json'), JSON.stringify({
      memory: { decayEnabled: false, decayHalfLifeDays: 90, graphBoost: 0.3 },
    }));
    const cfg = loadProjectMemCfg(dir, 45);
    assert.equal(cfg.decayEnabled, false);
    assert.equal(cfg.halfLifeDays, 90);
    assert.equal(cfg.graphBoost, 0.3);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('loadProjectMemCfg ignores invalid JSON in config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-se-test-'));
  try {
    const arcDir = path.join(dir, '.agentos');
    fs.mkdirSync(arcDir);
    fs.writeFileSync(path.join(arcDir, 'config.json'), 'not-json');
    const cfg = loadProjectMemCfg(dir, 45);
    assert.equal(cfg.halfLifeDays, 45); // falls back to default
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('loadProjectMemCfg uses defaultHalfLife when not in config', () => {
  const cfg = loadProjectMemCfg('/no/such/path', 30);
  assert.equal(cfg.halfLifeDays, 30);
});

// ── FTS fallback model filter (HS-02) ────────────────────────────────────────

const FTS_FALLBACK_SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, id UNINDEXED, path UNINDEXED, source UNINDEXED,
  model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED
);
`;

function openFtsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(FTS_FALLBACK_SCHEMA);
  return db;
}

function insertChunk(db, { id, model, text }) {
  db.prepare(
    'INSERT INTO chunks (id, path, source, start_line, end_line, model, text, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, 'test.md', 'memory', 1, 1, model, text, 1000);
  db.prepare(
    'INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line) VALUES (?,?,?,?,?,?,?)'
  ).run(text, id, 'test.md', 'memory', model, 1, 1);
}

// Inlined from the fixed fallback branch in searchEngine.ts
function runFtsFallback(db, ftsQ, provider) {
  const modelClause = provider ? ' AND c.model = ?' : '';
  const modelArgs = provider ? [provider.model] : [];
  return db
    .prepare(
      `SELECT c.id, c.model FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.id
       WHERE chunks_fts MATCH ?${modelClause}
       ORDER BY -bm25(chunks_fts) ASC LIMIT 10`
    )
    .all(ftsQ, ...modelArgs);
}

test('FTS fallback with provider filters to matching model only', () => {
  const db = openFtsDb();
  insertChunk(db, { id: 'a1', model: 'model-a', text: 'typescript compiler internals' });
  insertChunk(db, { id: 'b1', model: 'model-b', text: 'typescript language server' });
  const rows = runFtsFallback(db, '"typescript"', { model: 'model-a' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a1');
  db.close();
});

test('FTS fallback without provider returns all model chunks', () => {
  const db = openFtsDb();
  insertChunk(db, { id: 'a1', model: 'model-a', text: 'typescript compiler internals' });
  insertChunk(db, { id: 'b1', model: 'model-b', text: 'typescript language server' });
  const rows = runFtsFallback(db, '"typescript"', null);
  assert.equal(rows.length, 2);
  db.close();
});

// ── HS-05: embedding batch-fetch from chunks_vec ──────────────────────────────

// Inlined from the batch-fetch block added in searchEngine.ts for HS-05.
// Uses a plain BLOB table (no sqlite-vec extension needed) to test the fetch + decode path.
function fetchFilteredEmbs(db, filtered) {
  if (filtered.length === 0) return undefined;
  const placeholders = filtered.map(() => '?').join(', ');
  const embRows = db
    .prepare(`SELECT id, embedding FROM chunks_vec WHERE id IN (${placeholders})`)
    .all(...filtered.map((r) => r.id));
  const embMap = new Map(
    embRows.map((r) => [r.id, Array.from(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4))])
  );
  return filtered.map((r) => embMap.get(r.id) ?? null);
}

function openEmbDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE chunks_vec (id TEXT PRIMARY KEY, embedding BLOB NOT NULL)');
  return db;
}

function insertEmb(db, id, vec) {
  const buf = Buffer.from(new Float32Array(vec).buffer);
  db.prepare('INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)').run(id, buf);
}

test('fetchFilteredEmbs returns non-null embeddings for known ids', () => {
  const db = openEmbDb();
  insertEmb(db, 'a', [1, 0, 0]);
  insertEmb(db, 'b', [0, 1, 0]);
  const filtered = [{ id: 'a' }, { id: 'b' }];
  const embs = fetchFilteredEmbs(db, filtered);
  assert.equal(embs.length, 2);
  assert.ok(Array.isArray(embs[0]));
  assert.ok(Math.abs(embs[0][0] - 1) < 1e-6, 'first component of a should be 1');
  assert.ok(Math.abs(embs[1][1] - 1) < 1e-6, 'second component of b should be 1');
  db.close();
});

test('fetchFilteredEmbs returns null for ids missing from chunks_vec', () => {
  const db = openEmbDb();
  insertEmb(db, 'a', [1, 0]);
  const filtered = [{ id: 'a' }, { id: 'missing' }];
  const embs = fetchFilteredEmbs(db, filtered);
  assert.ok(embs[0] !== null);
  assert.equal(embs[1], null);
  db.close();
});

test('fetchFilteredEmbs returns undefined for empty filtered set', () => {
  const db = openEmbDb();
  assert.equal(fetchFilteredEmbs(db, []), undefined);
  db.close();
});

test('fetchFilteredEmbs preserves order matching filtered array', () => {
  const db = openEmbDb();
  insertEmb(db, 'x', [0, 0, 1]);
  insertEmb(db, 'y', [0, 1, 0]);
  // filtered in reverse insertion order
  const filtered = [{ id: 'y' }, { id: 'x' }];
  const embs = fetchFilteredEmbs(db, filtered);
  assert.ok(Math.abs(embs[0][1] - 1) < 1e-6, 'embs[0] should be y=[0,1,0]');
  assert.ok(Math.abs(embs[1][2] - 1) < 1e-6, 'embs[1] should be x=[0,0,1]');
  db.close();
});

// ── SS-03: observation boost cap ──────────────────────────────────────────────

const OBS_CAP = 0.20;

// Mirrors the obs boost block in searchEngine.ts searchMemory() (the if (obsHits.length > 0) block).
// If the source logic changes, update this function and OBS_CAP to match.
function applyObsBoost(obsHits, merged, obsWeight) {
  const obsBoostMap = new Map();
  obsHits.forEach((h, i) => {
    if (h.sourceChunkId) {
      const existing = obsBoostMap.get(h.sourceChunkId) ?? 0;
      obsBoostMap.set(h.sourceChunkId, Math.min(OBS_CAP, existing + obsWeight / (1 + i)));
    }
  });
  return merged.map((r) => {
    const boost = obsBoostMap.get(r.id);
    if (!boost) return r;
    return { ...r, score: r.score + boost * (1 - r.score) };
  });
}

test('obs boost with 10 hits is capped at OBS_CAP (0.20)', () => {
  const chunkId = 'chunk-1';
  // 10 hits all pointing at the same chunk
  const obsHits = Array.from({ length: 10 }, (_, i) => ({ sourceChunkId: chunkId, entityId: `e${i}` }));
  const result = applyObsBoost(obsHits, [{ id: chunkId, score: 0.0 }], 0.15);
  assert.ok(result[0].score <= 0.20 + 1e-9, `score ${result[0].score} should not exceed OBS_CAP 0.20`);
});

test('obs boost accumulates up to cap across hits from same chunk', () => {
  const chunkId = 'chunk-a';
  // 2 hits — first adds 0.15/1=0.15, second would add 0.15/2=0.075; cap is 0.20
  const obsHits = [
    { sourceChunkId: chunkId, entityId: 'e0' },
    { sourceChunkId: chunkId, entityId: 'e1' },
  ];
  const result = applyObsBoost(obsHits, [{ id: chunkId, score: 0.0 }], 0.15);
  // after 2 hits: min(0.20, 0.15) = 0.15; then min(0.20, 0.15 + 0.075) = 0.20
  assert.ok(Math.abs(result[0].score - 0.20) < 1e-9, `expected 0.20, got ${result[0].score}`);
});

test('obs boost single hit is below cap', () => {
  const chunkId = 'chunk-b';
  const obsHits = [{ sourceChunkId: chunkId, entityId: 'e0' }];
  const result = applyObsBoost(obsHits, [{ id: chunkId, score: 0.5 }], 0.15);
  // residual form: 0.5 + 0.15 * (1 - 0.5) = 0.575
  assert.ok(Math.abs(result[0].score - 0.575) < 1e-9, `expected 0.575, got ${result[0].score}`);
});

// ── SS-05 / SS-06: graph boost (residual form + hop-aware multipliers) ────────

const HOP_MULTIPLIERS_TEST = [1.0, 0.6, 0.3];
const OBS_GRAPH_MULTIPLIER_TEST = 0.5;

// Mirrors the graph boost map in searchEngine.ts searchMemory() (the if (relatedIds.size > 0) block).
// relatedIds: Map<chunkId, hopDistance>; obsEntityIds: chunk IDs that already received an obs boost
function applyGraphBoost(candidates, relatedIds, graphBoost, obsEntityIds = []) {
  const obsEntitySet = new Set(obsEntityIds);
  return candidates.map((r) => {
    const hop = relatedIds.get(r.id);
    if (hop === undefined) return r;
    const multiplier = (HOP_MULTIPLIERS_TEST[hop] ?? 0.3) * (obsEntitySet.has(r.id) ? OBS_GRAPH_MULTIPLIER_TEST : 1.0);
    const boost = graphBoost * multiplier;
    return { ...r, score: r.score + boost * (1 - r.score) };
  });
}

test('graph boost residual: high-scoring chunk gains less than low-scoring chunk', () => {
  const high = { id: 'h', score: 0.9 };
  const low = { id: 'l', score: 0.3 };
  const result = applyGraphBoost([high, low], new Map([['h', 0], ['l', 0]]), 0.15);
  const highGain = result[0].score - 0.9;
  const lowGain = result[1].score - 0.3;
  assert.ok(highGain < lowGain, `high gain (${highGain.toFixed(4)}) should < low gain (${lowGain.toFixed(4)})`);
  assert.ok(result[0].score <= 1 && result[1].score <= 1, 'scores must not exceed 1');
});

test('graph boost residual: score 0.9 with boost 0.15 gives 0.915', () => {
  const result = applyGraphBoost([{ id: 'a', score: 0.9 }], new Map([['a', 0]]), 0.15);
  // 0.9 + 0.15 * 1.0 * (1 - 0.9) = 0.915
  assert.ok(Math.abs(result[0].score - 0.915) < 1e-9, `expected 0.915, got ${result[0].score}`);
});

test('graph boost does not affect non-related chunks', () => {
  const result = applyGraphBoost([{ id: 'x', score: 0.7 }], new Map([['other', 0]]), 0.15);
  assert.equal(result[0].score, 0.7);
});

// ── SS-06: hop-aware multipliers ──────────────────────────────────────────────

test('SS-06: seed-entity chunk (hop 0) scores higher than 1-hop chunk with same base score', () => {
  const seed = { id: 'seed', score: 0.5 };
  const hop1 = { id: 'hop1', score: 0.5 };
  const result = applyGraphBoost([seed, hop1], new Map([['seed', 0], ['hop1', 1]]), 0.15);
  // seed: 0.5 + 0.15*1.0*(1-0.5) = 0.575
  // hop1: 0.5 + 0.15*0.6*(1-0.5) = 0.545
  assert.ok(result[0].score > result[1].score, `seed (${result[0].score}) should > hop1 (${result[1].score})`);
});

test('SS-06: 1-hop chunk scores higher than 2-hop chunk with same base score', () => {
  const hop1 = { id: 'hop1', score: 0.5 };
  const hop2 = { id: 'hop2', score: 0.5 };
  const result = applyGraphBoost([hop1, hop2], new Map([['hop1', 1], ['hop2', 2]]), 0.15);
  // hop1: 0.5 + 0.15*0.6*(1-0.5) = 0.545
  // hop2: 0.5 + 0.15*0.3*(1-0.5) = 0.5225
  assert.ok(result[0].score > result[1].score, `hop1 (${result[0].score}) should > hop2 (${result[1].score})`);
});

test('SS-06: out-of-range hop falls back to 0.3 multiplier', () => {
  const r = { id: 'r', score: 0.5 };
  const result = applyGraphBoost([r], new Map([['r', 99]]), 0.15);
  // 0.5 + 0.15*0.3*(1-0.5) = 0.5225
  assert.ok(Math.abs(result[0].score - 0.5225) < 1e-9, `expected 0.5225, got ${result[0].score}`);
});

test('SS-06: obs-seeded chunk gets OBS_GRAPH_MULTIPLIER (0.5x) dampening vs regular 1-hop', () => {
  const obs = { id: 'obs', score: 0.5 };
  const reg = { id: 'reg', score: 0.5 };
  const relatedIds = new Map([['obs', 1], ['reg', 1]]);
  const result = applyGraphBoost([obs, reg], relatedIds, 0.15, ['obs']);
  // obs: 0.5 + 0.15*0.6*0.5*(1-0.5) = 0.5 + 0.0225 = 0.5225
  // reg: 0.5 + 0.15*0.6*(1-0.5) = 0.5 + 0.045 = 0.545
  assert.ok(result[1].score > result[0].score, `regular (${result[1].score}) should > obs-seeded (${result[0].score})`);
  assert.ok(Math.abs(result[0].score - 0.5225) < 1e-9, `obs expected 0.5225, got ${result[0].score}`);
});

// ── SS-07: code temporal decay ────────────────────────────────────────────────

// Mirrors the decay block added to searchCode() in searchEngine.ts.
// isEvergreenCode and applyDecay inlined to test the code-search decay path in isolation.

function isEvergreenCode(relPath) {
  return /(?:^|\/)(?:node_modules|\.git|vendor|dist|build|\.next|\.nuxt|__generated__|generated)(?:\/|$)/.test(relPath);
}

function calculateMultiplierForCode(ageInDays, halfLifeDays) {
  if (halfLifeDays <= 0 || !Number.isFinite(halfLifeDays)) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * Math.max(0, ageInDays));
}

function applyCodeDecay(results, halfLifeDays = 180, decayMinScore = 0.1, nowMs = Date.now()) {
  return results.map((r) => {
    if (r.pinned) return r;
    if (isEvergreenCode(r.path)) return r;
    if (!r.updatedAt || r.updatedAt <= 0) return r;
    const ageInDays = (nowMs - r.updatedAt) / 86_400_000;
    const multiplier = calculateMultiplierForCode(ageInDays, halfLifeDays);
    const decayed = r.score * multiplier;
    const floored = decayMinScore > 0 ? Math.max(decayMinScore, decayed) : decayed;
    return { ...r, score: Number(floored.toFixed(4)) };
  });
}

const CODE_NOW = new Date('2026-05-23T00:00:00Z').getTime();

test('SS-07: code chunk 200 days old scores lower than chunk 10 days old', () => {
  const recent = { id: 'a', path: 'src/a.ts', score: 1.0, updatedAt: CODE_NOW - 10 * 86_400_000 };
  const stale = { id: 'b', path: 'src/b.ts', score: 1.0, updatedAt: CODE_NOW - 200 * 86_400_000 };
  const out = applyCodeDecay([recent, stale], 180, 0.1, CODE_NOW);
  assert.ok(out[0].score > out[1].score, `recent (${out[0].score}) should > stale (${out[1].score})`);
});

test('SS-07: code chunk at exactly 180 days decays to ~0.5', () => {
  const r = { id: 'a', path: 'src/a.ts', score: 1.0, updatedAt: CODE_NOW - 180 * 86_400_000 };
  const out = applyCodeDecay([r], 180, 0.0, CODE_NOW);
  assert.ok(Math.abs(out[0].score - 0.5) < 0.001, `expected ~0.5, got ${out[0].score}`);
});

test('SS-07: pinned code chunk is exempt from decay', () => {
  const r = { id: 'a', path: 'src/a.ts', score: 0.9, updatedAt: CODE_NOW - 200 * 86_400_000, pinned: true };
  const out = applyCodeDecay([r], 180, 0.1, CODE_NOW);
  assert.equal(out[0].score, 0.9);
});

test('SS-07: node_modules chunk is exempt from decay', () => {
  const r = { id: 'a', path: 'node_modules/lodash/index.js', score: 0.9, updatedAt: CODE_NOW - 400 * 86_400_000 };
  const out = applyCodeDecay([r], 180, 0.1, CODE_NOW);
  assert.equal(out[0].score, 0.9);
});

test('SS-07: decayMinScore=0.1 floors very old chunk', () => {
  const r = { id: 'a', path: 'src/a.ts', score: 0.5, updatedAt: CODE_NOW - 3650 * 86_400_000 };
  const out = applyCodeDecay([r], 180, 0.1, CODE_NOW);
  assert.ok(out[0].score >= 0.1, `expected floor 0.1, got ${out[0].score}`);
});

test('SS-07: halfLifeDays=0 disables decay (score unchanged)', () => {
  const r = { id: 'a', path: 'src/a.ts', score: 0.9, updatedAt: CODE_NOW - 500 * 86_400_000 };
  const out = applyCodeDecay([r], 0, 0.0, CODE_NOW);
  assert.equal(out[0].score, 0.9);
});

test('SS-07: updatedAt=0 skips decay', () => {
  const r = { id: 'a', path: 'src/a.ts', score: 0.8, updatedAt: 0 };
  const out = applyCodeDecay([r], 180, 0.1, CODE_NOW);
  assert.equal(out[0].score, 0.8);
});

// ── SS-08: source-specific RRF weights for code search ────────────────────────

// Inlined from hybrid.ts to exercise the weight-crossover point in isolation.
const SS08_K = 20;
function mergeHybridSS08({ vector, keyword, vectorWeight = 0.7, textWeight = 0.3 } = {}) {
  const maxRrf = (vectorWeight + textWeight) / SS08_K;
  if (maxRrf === 0) return [];
  const vectorMap = new Map(vector.map((r, i) => [r.id, { rank: i + 1, row: r }]));
  const keywordMap = new Map(keyword.map((r, i) => [r.id, { rank: i + 1, row: r }]));
  const allIds = new Set([...vectorMap.keys(), ...keywordMap.keys()]);
  const results = [];
  for (const id of allIds) {
    const vEntry = vectorMap.get(id);
    const kEntry = keywordMap.get(id);
    const rrf =
      (vEntry ? vectorWeight / (SS08_K + vEntry.rank) : 0) +
      (kEntry ? textWeight / (SS08_K + kEntry.rank) : 0);
    results.push({ id, score: Math.min(1, rrf / maxRrf) });
  }
  return results.sort((a, b) => b.score - a.score);
}

function makeCodeVec(id) {
  return { id };
}
function makeCodeKw(id, bm25_rank) {
  return { id, bm25_rank };
}

test('SS-08: under memory weights (0.7/0.3) vector rank-10 outranks keyword rank-1', () => {
  // vector array: 10 items so 'vec' is at rank 10
  const vectors = Array.from({ length: 10 }, (_, i) => makeCodeVec(i < 9 ? `other${i}` : 'vec'));
  const keywords = [makeCodeKw('kw', 0)]; // bm25_rank=0 → best keyword result
  const results = mergeHybridSS08({ vector: vectors, keyword: keywords, vectorWeight: 0.7, textWeight: 0.3 });
  const vec = results.find((r) => r.id === 'vec');
  const kw = results.find((r) => r.id === 'kw');
  assert.ok(vec.score > kw.score, `memory weights: vec rank-10 (${vec.score.toFixed(4)}) should > kw rank-1 (${kw.score.toFixed(4)})`);
});

test('SS-08: under code weights (0.55/0.45) keyword rank-1 outranks vector rank-10', () => {
  const vectors = Array.from({ length: 10 }, (_, i) => makeCodeVec(i < 9 ? `other${i}` : 'vec'));
  const keywords = [makeCodeKw('kw', 0)];
  const results = mergeHybridSS08({ vector: vectors, keyword: keywords, vectorWeight: 0.55, textWeight: 0.45 });
  const vec = results.find((r) => r.id === 'vec');
  const kw = results.find((r) => r.id === 'kw');
  assert.ok(kw.score > vec.score, `code weights: kw rank-1 (${kw.score.toFixed(4)}) should > vec rank-10 (${vec.score.toFixed(4)})`);
});
