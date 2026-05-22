/**
 * Functional tests for memory/mmr.ts pure logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from mmr.ts ───────────────────────────────────────────────────────

function tokenize(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
}

function jaccardSimilarity(a, b) {
  const smaller = a.size <= b.size ? a : b;
  const larger  = a.size <= b.size ? b : a;
  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function mmrRerank(items, config = {}, embeddings) {
  const DEFAULT = { enabled: true, lambda: 0.7 };
  const cfg = { ...DEFAULT, ...config };
  if (!cfg.enabled || items.length <= 1 || cfg.lambda >= 1) {
    return [...items].sort((a, b) => b.score - a.score);
  }

  const paired = items.map((item, i) => ({ item, emb: embeddings?.[i] ?? null }));
  const sorted = [...paired].sort((a, b) => b.item.score - a.item.score);
  const sortedItems = sorted.map((p) => p.item);
  const sortedEmbs  = sorted.map((p) => p.emb);

  const minScore = sortedItems.at(-1).score;
  const maxScore = sortedItems[0].score;
  const range = maxScore - minScore || 1;
  const tokenSets  = sortedItems.map((item) => tokenize(item.text));
  const normScores = sortedItems.map((item) => (item.score - minScore) / range);

  const selected = [];
  const selectedIndices = [];
  const remaining = sortedItems.map((_, i) => i);

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;
    for (const idx of remaining) {
      let maxSim = 0;
      for (const selIdx of selectedIndices) {
        const hasEmb = sortedEmbs[idx] != null && sortedEmbs[selIdx] != null;
        const sim = hasEmb
          ? cosineSim(sortedEmbs[idx], sortedEmbs[selIdx])
          : jaccardSimilarity(tokenSets[idx], tokenSets[selIdx]);
        if (sim > maxSim) maxSim = sim;
      }
      const mmrScore = cfg.lambda * normScores[idx] - (1 - cfg.lambda) * maxSim;
      if (mmrScore > bestMMR) { bestMMR = mmrScore; bestIdx = idx; }
    }
    if (bestIdx === -1) break;
    selected.push(sortedItems[bestIdx]);
    selectedIndices.push(bestIdx);
    remaining.splice(remaining.indexOf(bestIdx), 1);
  }
  return selected;
}

// ── tokenize ──────────────────────────────────────────────────────────────────

test('tokenize returns empty set for empty string', () => {
  assert.equal(tokenize('').size, 0);
});

test('tokenize lowercases tokens', () => {
  assert.ok(tokenize('Hello World').has('hello'));
  assert.ok(tokenize('Hello World').has('world'));
});

test('tokenize strips punctuation', () => {
  assert.ok(tokenize('foo, bar!').has('foo'));
  assert.ok(tokenize('foo, bar!').has('bar'));
});

test('tokenize deduplicates repeated tokens', () => {
  const s = tokenize('cat cat cat');
  assert.equal(s.size, 1);
});

// ── jaccardSimilarity ─────────────────────────────────────────────────────────

test('jaccardSimilarity returns 0 for empty sets', () => {
  assert.equal(jaccardSimilarity(new Set(), new Set()), 0);
});

test('jaccardSimilarity returns 1 for identical sets', () => {
  const s = new Set(['a', 'b', 'c']);
  assert.equal(jaccardSimilarity(s, s), 1);
});

test('jaccardSimilarity returns 0 for disjoint sets', () => {
  assert.equal(jaccardSimilarity(new Set(['a']), new Set(['b'])), 0);
});

test('jaccardSimilarity is symmetric', () => {
  const a = new Set(['a', 'b', 'c']);
  const b = new Set(['b', 'c', 'd']);
  assert.equal(jaccardSimilarity(a, b), jaccardSimilarity(b, a));
});

test('jaccardSimilarity partial overlap', () => {
  const a = new Set(['a', 'b']);
  const b = new Set(['b', 'c']);
  // intersection=1, union=3 → 1/3
  assert.ok(Math.abs(jaccardSimilarity(a, b) - 1 / 3) < 1e-10);
});

// ── cosineSim ─────────────────────────────────────────────────────────────────

test('cosineSim returns 1 for identical vectors', () => {
  const v = [1, 2, 3];
  assert.ok(Math.abs(cosineSim(v, v) - 1) < 1e-10);
});

test('cosineSim returns 0 for orthogonal vectors', () => {
  assert.ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-10);
});

test('cosineSim returns 0 for zero vector', () => {
  assert.equal(cosineSim([0, 0], [1, 2]), 0);
});

// ── mmrRerank ─────────────────────────────────────────────────────────────────

function item(text, score) { return { text, score }; }

test('mmrRerank returns empty for empty input', () => {
  assert.deepEqual(mmrRerank([]), []);
});

test('mmrRerank returns single item unchanged', () => {
  const result = mmrRerank([item('hello', 0.9)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'hello');
});

test('mmrRerank with enabled=false returns relevance-sorted order', () => {
  const items = [item('b', 0.5), item('a', 0.9), item('c', 0.1)];
  const result = mmrRerank(items, { enabled: false });
  assert.equal(result[0].score, 0.9);
  assert.equal(result[1].score, 0.5);
  assert.equal(result[2].score, 0.1);
});

test('mmrRerank with lambda=1 returns pure relevance order', () => {
  const items = [item('b low', 0.3), item('a high', 0.9)];
  const result = mmrRerank(items, { lambda: 1 });
  assert.equal(result[0].text, 'a high');
});

test('mmrRerank demotes near-duplicate high-scoring item', () => {
  // Two identical texts: second should be pushed down
  const items = [
    item('the quick brown fox jumps', 0.9),
    item('the quick brown fox jumps', 0.85), // near-duplicate
    item('completely different topic here', 0.7),
  ];
  const result = mmrRerank(items, { lambda: 0.5 });
  // First item is always the top-scoring one
  assert.equal(result[0].score, 0.9);
  // The diverse item should rank above the duplicate
  const diverseIdx = result.findIndex((r) => r.text === 'completely different topic here');
  const dupIdx = result.findIndex((r, i) => i > 0 && r.text === 'the quick brown fox jumps');
  assert.ok(diverseIdx < dupIdx, 'diverse item should rank above duplicate');
});

test('mmrRerank preserves all items', () => {
  const items = [item('alpha', 0.9), item('beta', 0.7), item('gamma', 0.5)];
  const result = mmrRerank(items);
  assert.equal(result.length, items.length);
});

test('mmrRerank all items have same score — still returns all', () => {
  const items = [item('foo', 0.5), item('bar', 0.5), item('baz', 0.5)];
  assert.equal(mmrRerank(items).length, 3);
});

// ── mmrRerank with embeddings ─────────────────────────────────────────────────

test('mmrRerank with identical embeddings maximally penalises duplicate', () => {
  const emb = [1, 0, 0];
  const items = [
    item('alpha semantics', 0.9),
    item('beta semantics',  0.85), // same embedding → cosine=1 → max penalty
    item('gamma semantics', 0.7),
  ];
  // All different text so Jaccard wouldn't catch them; embeddings are identical for first two
  const embeddings = [emb, emb, [0, 1, 0]];
  const result = mmrRerank(items, { lambda: 0.5 }, embeddings);
  assert.equal(result[0].score, 0.9); // top scorer always first
  // gamma (orthogonal embedding) should rank above the cosine-duplicate beta
  const gammaIdx = result.findIndex((r) => r.text === 'gamma semantics');
  const betaIdx  = result.findIndex((r) => r.text === 'beta semantics');
  assert.ok(gammaIdx < betaIdx, 'diverse embedding item should rank above cosine-duplicate');
});

test('mmrRerank null embeddings fall back to Jaccard — same ordering as no-embeddings call', () => {
  const items = [
    item('the quick brown fox', 0.9),
    item('the quick brown fox', 0.85),
    item('completely different', 0.7),
  ];
  const withNull   = mmrRerank(items, { lambda: 0.5 }, [null, null, null]);
  const withoutEmb = mmrRerank(items, { lambda: 0.5 });
  assert.deepEqual(withNull.map((r) => r.text), withoutEmb.map((r) => r.text));
});

test('mmrRerank omitting embeddings param gives identical result to all-null embeddings', () => {
  const items = [item('foo bar', 0.9), item('foo bar', 0.8), item('baz qux', 0.6)];
  const omitted = mmrRerank(items, { lambda: 0.6 });
  const allNull  = mmrRerank(items, { lambda: 0.6 }, [null, null, null]);
  assert.deepEqual(omitted.map((r) => r.text), allNull.map((r) => r.text));
});

test('mmrRerank mixed embeddings: cosine where available, Jaccard where null', () => {
  // item[0] and item[1] share embedding → should be penalised via cosine
  // item[2] has null → falls back to Jaccard (text is different, Jaccard≈0)
  const items = [
    item('semantic chunk A', 0.9),
    item('semantic chunk B', 0.85),
    item('unrelated content', 0.7),
  ];
  const sharedEmb = [1, 0];
  const embeddings = [sharedEmb, sharedEmb, null];
  const result = mmrRerank(items, { lambda: 0.5 }, embeddings);
  assert.equal(result.length, 3);
  assert.equal(result[0].text, 'semantic chunk A');
  // unrelated should beat the cosine-duplicate
  const unrelIdx = result.findIndex((r) => r.text === 'unrelated content');
  const dupIdx   = result.findIndex((r) => r.text === 'semantic chunk B');
  assert.ok(unrelIdx < dupIdx, 'unrelated item should rank above cosine-duplicate');
});
