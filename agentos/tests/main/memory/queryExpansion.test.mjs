/**
 * Tests for memory/query-expansion.ts — extractKeywords.
 * Function inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from query-expansion.ts ──────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','this','that','these','those','any','all','both','each','few','more','most',
  'other','some','such','no','nor','not','only','own','same','so','than','too','very',
  'i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself',
  'yourselves','he','him','his','himself','she','her','hers','herself','it','its','itself',
  'they','them','their','theirs','themselves','what','which','who','whom','when','where',
  'why','how',
  'is','am','are','was','were','be','been','being','have','has','had','having','do','does',
  'did','doing','will','would','shall','should','may','might','must','can','could',
  'get','got','make','made','know','think','take','see','come','go','say','said','tell',
  'told','use','find','give','want','look','seem','feel','try','leave','call','keep','let','work',
  'in','on','at','by','for','with','about','against','between','into','through','during',
  'before','after','above','below','to','from','up','down','out','off','over','under',
  'again','further','then','once','and','but','or','if','as','of','per','via',
  'please','thanks','thank','just','also','like','well','now','here','there','back',
  'still','even','around','show','give','list','tell','earlier','recent','latest','last',
  'first','next','previous','old','new',
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test('extractKeywords: empty string returns empty array', () => {
  assert.deepEqual(extractKeywords(''), []);
});

test('extractKeywords: stop words filtered out', () => {
  const result = extractKeywords('what was the poem title from earlier');
  assert.ok(!result.includes('what'));
  assert.ok(!result.includes('the'));
  assert.ok(!result.includes('from'));
  assert.ok(!result.includes('earlier'));
  assert.ok(result.includes('poem'));
  assert.ok(result.includes('title'));
});

test('extractKeywords: returns lowercase tokens', () => {
  const result = extractKeywords('Memory Database Search');
  assert.deepEqual(result, ['memory', 'database', 'search']);
});

test('extractKeywords: deduplicates tokens', () => {
  const result = extractKeywords('memory memory memory search search');
  assert.equal(result.filter((k) => k === 'memory').length, 1);
  assert.equal(result.filter((k) => k === 'search').length, 1);
});

test('extractKeywords: capped at 10 results', () => {
  const words = ['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa','lambda'];
  const result = extractKeywords(words.join(' '));
  assert.equal(result.length, 10);
});

test('extractKeywords: single-char tokens skipped', () => {
  const result = extractKeywords('a b c test');
  assert.ok(!result.includes('a'));
  assert.ok(!result.includes('b'));
  assert.ok(!result.includes('c'));
  assert.ok(result.includes('test'));
});

test('extractKeywords: underscores included in tokens', () => {
  const result = extractKeywords('snake_case variable');
  assert.ok(result.includes('snake_case'));
});

test('extractKeywords: numbers included', () => {
  const result = extractKeywords('version 42 release');
  assert.ok(result.includes('42'));
  assert.ok(result.includes('version'));
  assert.ok(result.includes('release'));
});

test('extractKeywords: punctuation stripped', () => {
  const result = extractKeywords('hello, world! foo.');
  assert.ok(result.includes('hello'));
  assert.ok(result.includes('world'));
  assert.ok(result.includes('foo'));
});
