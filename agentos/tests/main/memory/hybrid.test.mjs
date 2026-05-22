/**
 * Functional tests for memory/hybrid.ts pure logic.
 * Functions are inlined from source (no TS/Electron deps).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from hybrid.ts / query-expansion.ts ──────────────────────────────

// Keep in sync with src/main/memory/query-expansion.ts STOP_WORDS
const STOP_WORDS = new Set([
  'a','an','the','this','that','these','those','any','all','both','each','few',
  'more','most','other','some','such','no','nor','not','only','own','same','so',
  'than','too','very',
  'i','me','my','myself','we','our','ours','ourselves','you','your','yours',
  'yourself','yourselves','he','him','his','himself','she','her','hers','herself',
  'it','its','itself','they','them','their','theirs','themselves',
  'what','which','who','whom','when','where','why','how',
  'is','am','are','was','were','be','been','being','have','has','had','having',
  'do','does','did','doing','will','would','shall','should','may','might','must',
  'can','could','get','got','make','made','know','think','take','see','come','go',
  'say','said','tell','told','use','find','give','want','look','seem','feel','try',
  'leave','call','keep','let','work',
  'in','on','at','by','for','with','about','against','between','into','through',
  'during','before','after','above','below','to','from','up','down','out','off',
  'over','under','again','further','then','once','and','but','or','if','as','of',
  'per','via',
  'please','thanks','thank','just','also','like','well','now','here','there',
  'back','still','even','around','show','give','list','tell','earlier','recent',
  'latest','last','first','next','previous','old','new',
]);

function extractKeywords(query) {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set();
  const keywords = [];
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    if (t.length < 2) continue;
    if (STOP_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    keywords.push(t);
    if (keywords.length >= 10) break;
  }
  return keywords;
}

const FTS_AND_THRESHOLD = 4;
const K = 20;

function buildFtsQuery(raw, forceOr = false) {
  const allTokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map((t) => t.toLowerCase()).filter(Boolean) ?? [];
  if (allTokens.length === 0) return null;
  const keywords = extractKeywords(raw);
  if (keywords.length === 0) {
    return allTokens.map((t) => `"${t.replaceAll('"', '')}"`).join(' AND ');
  }
  const join = !forceOr && keywords.length >= FTS_AND_THRESHOLD ? ' AND ' : ' OR ';
  return keywords.map((t) => `"${t.replaceAll('"', '')}"`).join(join);
}

function bm25RankToScore(rank) {
  const r = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + r);
}

const PIN_BOOST = 0.2;
const EXPANSION_BOOST_PER_COUNT = 0.05;
const EXPANSION_BOOST_MAX = 0.2;

function mergeHybridResults({ vector, keyword, vectorWeight = 0.7, textWeight = 0.3, expansionCounts } = {}) {
  const maxRrf = (vectorWeight + textWeight) / K;
  if (maxRrf === 0) return [];
  const vectorMap = new Map(vector.map((r, i) => [r.id, { rank: i + 1, row: r }]));
  const keywordMap = new Map(keyword.map((r, i) => [r.id, { rank: i + 1, row: r }]));
  const allIds = new Set([...vectorMap.keys(), ...keywordMap.keys()]);
  const map = new Map();
  for (const id of allIds) {
    const vEntry = vectorMap.get(id);
    const kEntry = keywordMap.get(id);
    const row = vEntry?.row ?? kEntry?.row;
    const rrf =
      (vEntry ? vectorWeight / (K + vEntry.rank) : 0) +
      (kEntry ? textWeight  / (K + kEntry.rank)  : 0);
    const score = Math.min(1, rrf / maxRrf);
    map.set(id, {
      id, path: row.path, source: row.source,
      startLine: row.start_line, endLine: row.end_line,
      text: row.text, model: row.model, updatedAt: row.updated_at,
      vectorScore: vEntry ? Math.max(0, Math.min(1, 1 - vEntry.row.dist)) : 0,
      textScore: kEntry ? bm25RankToScore(kEntry.row.bm25_rank) : 0,
      score,
      pinned: (vEntry?.row.pinned ?? kEntry?.row.pinned ?? 0) === 1,
    });
  }
  const results = [...map.values()];
  for (const r of results) {
    if (r.pinned) r.score = r.score + PIN_BOOST * (1 - r.score);
    if (expansionCounts) {
      const count = expansionCounts.get(r.id) ?? 0;
      if (count > 0) r.score = r.score + Math.min(EXPANSION_BOOST_MAX, count * EXPANSION_BOOST_PER_COUNT) * (1 - r.score);
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// ── buildFtsQuery ─────────────────────────────────────────────────────────────

test('buildFtsQuery returns null for empty string', () => {
  assert.equal(buildFtsQuery(''), null);
});

test('buildFtsQuery returns null for whitespace-only string', () => {
  assert.equal(buildFtsQuery('   '), null);
});

test('buildFtsQuery wraps single token in quotes', () => {
  assert.equal(buildFtsQuery('hello'), '"hello"');
});

test('buildFtsQuery OR-joins multiple tokens below threshold', () => {
  assert.equal(buildFtsQuery('hello world'), '"hello" OR "world"');
});

test('buildFtsQuery strips punctuation tokens', () => {
  assert.equal(buildFtsQuery('hello, world!'), '"hello" OR "world"');
});

test('buildFtsQuery handles unicode letters', () => {
  const result = buildFtsQuery('café résumé');
  assert.ok(result?.includes('"café"'), `expected café in ${result}`);
});

test('buildFtsQuery splits on non-word chars including double quotes', () => {
  // the tokenizer regex splits on non-word chars, so hel"lo → ["hel", "lo"]
  const result = buildFtsQuery('hel"lo');
  assert.equal(result, '"hel" OR "lo"');
});

test('buildFtsQuery AND-joins when keywords reach threshold', () => {
  // 5 meaningful keywords → AND for precision
  assert.equal(
    buildFtsQuery('typescript react hooks async await'),
    '"typescript" AND "react" AND "hooks" AND "async" AND "await"',
  );
});

test('buildFtsQuery OR-joins when keywords are below threshold', () => {
  // 3 meaningful keywords → OR for recall
  assert.equal(buildFtsQuery('one two three'), '"one" OR "two" OR "three"');
});

test('buildFtsQuery forceOr overrides AND threshold', () => {
  assert.equal(
    buildFtsQuery('typescript react hooks async await', true),
    '"typescript" OR "react" OR "hooks" OR "async" OR "await"',
  );
});

test('buildFtsQuery forceOr has no effect when all tokens are stop words', () => {
  // all-stop-word queries fall back to AND-of-all-tokens regardless of forceOr
  // so ftsQOr === ftsQ and the retry is skipped (no-op guard)
  const base = buildFtsQuery('what is the');
  const forced = buildFtsQuery('what is the', true);
  assert.equal(base, forced);
});

// ── bm25RankToScore ───────────────────────────────────────────────────────────

test('bm25RankToScore returns 1 for rank 0', () => {
  assert.equal(bm25RankToScore(0), 1);
});

test('bm25RankToScore returns 0.5 for rank 1', () => {
  assert.equal(bm25RankToScore(1), 0.5);
});

test('bm25RankToScore decreases as rank increases', () => {
  assert.ok(bm25RankToScore(1) > bm25RankToScore(5));
  assert.ok(bm25RankToScore(5) > bm25RankToScore(100));
});

test('bm25RankToScore returns near-zero for very large rank', () => {
  assert.ok(bm25RankToScore(999) < 0.002);
});

test('bm25RankToScore returns near-zero for non-finite rank', () => {
  assert.ok(bm25RankToScore(Infinity) < 0.002);
  assert.ok(bm25RankToScore(NaN) < 0.002);
});

test('bm25RankToScore clamps negative ranks to 0', () => {
  assert.equal(bm25RankToScore(-5), 1); // max(0,-5) = 0 → 1/(1+0) = 1
});

// ── mergeHybridResults ────────────────────────────────────────────────────────

function makeVec(id, dist = 0.2, pinned = 0) {
  return { id, path: `p/${id}`, source: 'memory', start_line: 1, end_line: 5,
           text: `text ${id}`, model: 'm', updated_at: 1000, dist, pinned };
}
function makeKw(id, bm25_rank = 1, pinned = 0) {
  return { id, path: `p/${id}`, source: 'memory', start_line: 1, end_line: 5,
           text: `text ${id}`, model: 'm', updated_at: 1000, bm25_rank, pinned };
}

test('mergeHybridResults empty inputs returns empty array', () => {
  assert.deepEqual(mergeHybridResults({ vector: [], keyword: [] }), []);
});

test('mergeHybridResults vector-only result has textScore 0', () => {
  const results = mergeHybridResults({ vector: [makeVec('a', 0.2)], keyword: [] });
  assert.equal(results.length, 1);
  assert.equal(results[0].textScore, 0);
  assert.ok(results[0].vectorScore > 0);
});

test('mergeHybridResults keyword-only result has vectorScore 0', () => {
  const results = mergeHybridResults({ vector: [], keyword: [makeKw('a', 0)] });
  assert.equal(results.length, 1);
  assert.equal(results[0].vectorScore, 0);
  assert.equal(results[0].textScore, 1); // bm25RankToScore(0) = 1
});

test('mergeHybridResults deduplicates by id and combines scores', () => {
  const results = mergeHybridResults({
    vector: [makeVec('a', 0.0)],  // vectorScore = 1.0
    keyword: [makeKw('a', 0)],    // textScore   = 1.0
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].vectorScore, 1.0);
  assert.equal(results[0].textScore, 1.0);
  assert.ok(results[0].score > 0 && results[0].score <= 1);
});

test('mergeHybridResults sorts by score descending', () => {
  // input pre-sorted best-first (as vector query returns); rank 1 beats rank 2
  const results = mergeHybridResults({
    vector: [makeVec('high', 0.0), makeVec('low', 0.9)],
    keyword: [],
  });
  assert.ok(results[0].score > results[1].score);
  assert.equal(results[0].id, 'high');
});

test('mergeHybridResults vectorWeight affects relative ordering', () => {
  // high vectorWeight → vector-only doc ranks above keyword-only doc
  const results = mergeHybridResults({
    vector: [makeVec('vec', 0.0)],
    keyword: [makeKw('kw', 0)],
    vectorWeight: 0.9,
    textWeight: 0.1,
  });
  assert.equal(results[0].id, 'vec');
  assert.ok(results[0].score > results[1].score);
});

test('mergeHybridResults vector dist clamped to [0,1]', () => {
  const results = mergeHybridResults({ vector: [makeVec('a', 1.5)], keyword: [] });
  assert.ok(results[0].vectorScore >= 0);
});

test('mergeHybridResults doc in both lists scores higher than doc in one list only', () => {
  const results = mergeHybridResults({
    vector: [makeVec('both', 0.1), makeVec('vecOnly', 0.1)],
    keyword: [makeKw('both', 1)],
  });
  const both = results.find((r) => r.id === 'both');
  const vecOnly = results.find((r) => r.id === 'vecOnly');
  assert.ok(both.score > vecOnly.score);
});

test('mergeHybridResults textWeight affects relative ordering', () => {
  // high textWeight → keyword-only doc ranks above vector-only doc
  const results = mergeHybridResults({
    vector: [makeVec('vec', 0.0)],
    keyword: [makeKw('kw', 0)],
    vectorWeight: 0.1,
    textWeight: 0.9,
  });
  assert.equal(results[0].id, 'kw');
  assert.ok(results[0].score > results[1].score);
});

test('mergeHybridResults pinned doc scores higher than equivalent unpinned doc', () => {
  const results = mergeHybridResults({
    vector: [makeVec('pinned', 0.1, 1), makeVec('normal', 0.1, 0)],
    keyword: [],
  });
  const pinned = results.find((r) => r.id === 'pinned');
  const normal = results.find((r) => r.id === 'normal');
  assert.ok(pinned.score > normal.score);
});

test('mergeHybridResults expansionCounts boost increases score', () => {
  const base = mergeHybridResults({ vector: [makeVec('a', 0.1)], keyword: [] });
  const boosted = mergeHybridResults({
    vector: [makeVec('a', 0.1)],
    keyword: [],
    expansionCounts: new Map([['a', 1]]),
  });
  assert.ok(boosted[0].score > base[0].score);
});

test('mergeHybridResults returns empty array when both weights are zero', () => {
  assert.deepEqual(
    mergeHybridResults({ vector: [makeVec('a')], keyword: [], vectorWeight: 0, textWeight: 0 }),
    [],
  );
});

test('mergeHybridResults rank-1 score exceeds rank-5 score by at least 15% relatively', () => {
  const vecs = [1, 2, 3, 4, 5].map((i) => makeVec(`v${i}`, 0.1 * i));
  const results = mergeHybridResults({ vector: vecs, keyword: [] });
  const rank1 = results[0].score;
  const rank5 = results[4].score;
  const relativeSpread = (rank1 - rank5) / rank5;
  assert.ok(relativeSpread >= 0.15, `relative spread ${(relativeSpread * 100).toFixed(1)}% < 15%`);
});
