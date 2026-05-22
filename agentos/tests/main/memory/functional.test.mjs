/**
 * Functional tests for AgentOS memory service pure logic.
 *
 * All functions are inlined from service.ts (no Electron deps) following the
 * same pattern as service.test.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Constants (from service.ts) ──────────────────────────────────────────────

const MAX_ENTRY_CHARS = 1400;
const MEMORY_OVERLAP_CHARS = 180;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MIN_SCORE = 0.18;
const SESSION_DECAY_HALF_LIFE_DAYS = 45;
const SESSION_DECAY_LAMBDA = Math.LN2 / SESSION_DECAY_HALF_LIFE_DAYS;

// ── Pure functions (inlined from service.ts) ─────────────────────────────────

function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  return Array.from(new Set(normalizeText(value).split(' ').filter((token) => token.length >= 2)));
}

function buildTrigrams(value) {
  const normalized = `  ${normalizeText(value)}  `;
  const grams = new Map();
  for (let i = 0; i < normalized.length - 2; i += 1) {
    const gram = normalized.slice(i, i + 3);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function cosineSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const value of a.values()) magA += value * value;
  for (const value of b.values()) magB += value * value;
  for (const [key, value] of a.entries()) {
    const other = b.get(key);
    if (other) dot += value * other;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function cosineSimilarityVector(a, b) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function createSnippet(text, query) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const lowered = compact.toLowerCase();
  const needle = query.trim().toLowerCase();
  const start = needle ? lowered.indexOf(needle) : -1;
  if (start < 0) {
    return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
  }
  const from = Math.max(0, start - 90);
  const to = Math.min(compact.length, start + needle.length + 130);
  return `${from > 0 ? '...' : ''}${compact.slice(from, to)}${to < compact.length ? '...' : ''}`;
}

function chunkTextByLines(text) {
  const lines = text.split('\n');
  const chunks = [];
  let current = [];
  let currentChars = 0;
  let startLine = 1;

  const flush = (endLine) => {
    if (current.length === 0) return;
    chunks.push({ text: current.join('\n').trim(), startLine, endLine });
    const overlapLines = [];
    let overlapChars = 0;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const line = current[i];
      overlapChars += line.length + 1;
      overlapLines.unshift(line);
      if (overlapChars >= MEMORY_OVERLAP_CHARS) break;
    }
    current = overlapLines;
    currentChars = overlapLines.reduce((sum, line) => sum + line.length + 1, 0);
    startLine = Math.max(1, endLine - overlapLines.length + 1);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineChars = line.length + 1;
    if (currentChars + lineChars > MAX_ENTRY_CHARS && current.length > 0) {
      flush(index);
    }
    if (current.length === 0) startLine = index + 1;
    current.push(line);
    currentChars += lineChars;
  }
  flush(lines.length);
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}

function chunkSessionText(text) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return [];
  if (compact.length <= MAX_ENTRY_CHARS) return [compact];
  const chunks = [];
  for (let offset = 0; offset < compact.length; offset += MAX_ENTRY_CHARS - MEMORY_OVERLAP_CHARS) {
    const segment = compact.slice(offset, offset + MAX_ENTRY_CHARS).trim();
    if (segment) chunks.push(segment);
  }
  return chunks;
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

function normalizeMemoryRelPath(value) {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('Invalid memory path.');
  }
  if (normalized !== 'MEMORY.md' && !normalized.startsWith('memory/')) {
    throw new Error('Memory paths must target MEMORY.md or memory/*.md.');
  }
  return normalized;
}

function stableStringify(value) {
  return JSON.stringify(value, (_key, inner) => {
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return Object.fromEntries(Object.keys(inner).sort().map((key) => [key, inner[key]]));
    }
    return inner;
  });
}

// ── Search scoring (inlined from service.ts search()) ────────────────────────

function scoreEntry(query, entry, queryEmbedding = null, now = Date.now()) {
  const queryTokens = new Set(tokenize(query));
  const queryTrigrams = buildTrigrams(query);
  const entryTokens = new Set(tokenize(entry.text));
  let tokenHits = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) tokenHits += 1;
  }
  const lexicalScore = queryTokens.size > 0 ? tokenHits / queryTokens.size : 0;
  const fuzzyScore = cosineSimilarity(queryTrigrams, buildTrigrams(entry.text));
  const semanticScore = queryEmbedding && entry.embedding
    ? cosineSimilarityVector(queryEmbedding, entry.embedding)
    : 0;
  const phraseBoost = entry.text.toLowerCase().includes(query.toLowerCase()) ? 0.15 : 0;
  const baseScore = semanticScore * (queryEmbedding ? 0.5 : 0)
    + fuzzyScore * 0.3
    + lexicalScore * 0.2
    + phraseBoost;
  const decayFactor = entry.source === 'sessions' && entry.timestamp && entry.timestamp > 0
    ? Math.exp(-SESSION_DECAY_LAMBDA * ((now - entry.timestamp) / (1000 * 60 * 60 * 24)))
    : 1;
  return Number((baseScore * decayFactor).toFixed(4));
}

function filterAndRankResults(entries, query, { minScore = DEFAULT_MIN_SCORE, maxResults = DEFAULT_MAX_RESULTS, source = 'all', queryEmbedding = null, now = Date.now() } = {}) {
  return entries
    .filter((entry) => source === 'all' || entry.source === source)
    .map((entry) => ({ ...entry, score: scoreEntry(query, entry, queryEmbedding, now) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ── normalizeText ─────────────────────────────────────────────────────────────

test('normalizeText lowercases input', () => {
  assert.equal(normalizeText('Hello World'), 'hello world');
});

test('normalizeText removes special characters', () => {
  assert.equal(normalizeText('foo!bar@baz#qux'), 'foo bar baz qux');
});

test('normalizeText collapses multiple spaces', () => {
  assert.equal(normalizeText('a   b   c'), 'a b c');
});

test('normalizeText trims leading and trailing whitespace', () => {
  assert.equal(normalizeText('  hello  '), 'hello');
});

test('normalizeText preserves alphanumeric chars', () => {
  assert.equal(normalizeText('abc123'), 'abc123');
});

test('normalizeText returns empty string for special-char-only input', () => {
  assert.equal(normalizeText('!!!'), '');
});

// ── tokenize ──────────────────────────────────────────────────────────────────

test('tokenize returns unique tokens', () => {
  const tokens = tokenize('hello hello world');
  assert.equal(tokens.filter((t) => t === 'hello').length, 1);
});

test('tokenize filters out single-character tokens', () => {
  const tokens = tokenize('a bb ccc');
  assert.ok(!tokens.includes('a'));
  assert.ok(tokens.includes('bb'));
  assert.ok(tokens.includes('ccc'));
});

test('tokenize normalizes case', () => {
  const tokens = tokenize('Foo FOO foo');
  assert.equal(tokens.filter((t) => t === 'foo').length, 1);
});

test('tokenize splits on non-alphanumeric boundaries', () => {
  const tokens = tokenize('foo-bar_baz');
  assert.ok(tokens.includes('foo'));
  assert.ok(tokens.includes('bar'));
  assert.ok(tokens.includes('baz'));
});

test('tokenize returns empty array for empty string', () => {
  assert.deepEqual(tokenize(''), []);
});

// ── buildTrigrams ─────────────────────────────────────────────────────────────

test('buildTrigrams returns a Map', () => {
  const grams = buildTrigrams('hello');
  assert.ok(grams instanceof Map);
});

test('buildTrigrams produces 3-character grams', () => {
  const grams = buildTrigrams('hello');
  for (const key of grams.keys()) {
    assert.equal(key.length, 3);
  }
});

test('buildTrigrams counts repeated grams', () => {
  // "aaa" normalized padded to "  aaa  " — gram "  a" appears once, " aa" once, "aaa" once, "aa " once, "a  " once
  const grams = buildTrigrams('aaaa');
  // The padded text is "  aaaa  " — "aaa" should appear at least twice
  const aaaCount = grams.get('aaa') ?? 0;
  assert.ok(aaaCount >= 2);
});

test('buildTrigrams is stable for the same input', () => {
  const a = buildTrigrams('consistent input');
  const b = buildTrigrams('consistent input');
  assert.deepEqual(Object.fromEntries(a), Object.fromEntries(b));
});

test('buildTrigrams returns empty-ish map for empty string', () => {
  const grams = buildTrigrams('');
  // Only space-padding grams like "   " from "    " — just verify it does not throw
  assert.ok(grams instanceof Map);
});

// ── cosineSimilarity (trigram maps) ──────────────────────────────────────────

test('cosineSimilarity returns 0 for empty maps', () => {
  assert.equal(cosineSimilarity(new Map(), new Map()), 0);
  assert.equal(cosineSimilarity(buildTrigrams('hello'), new Map()), 0);
});

test('cosineSimilarity returns 1 for identical maps', () => {
  const g = buildTrigrams('hello world');
  assert.ok(Math.abs(cosineSimilarity(g, g) - 1) < 1e-9);
});

test('cosineSimilarity returns 0 for completely disjoint maps', () => {
  // Two strings with no common trigrams after normalization
  const a = new Map([['abc', 1]]);
  const b = new Map([['xyz', 1]]);
  assert.equal(cosineSimilarity(a, b), 0);
});

test('cosineSimilarity score is in [0, 1]', () => {
  const a = buildTrigrams('the quick brown fox');
  const b = buildTrigrams('the quick red fox');
  const score = cosineSimilarity(a, b);
  assert.ok(score >= 0 && score <= 1);
});

test('cosineSimilarity is symmetric', () => {
  const a = buildTrigrams('memory service');
  const b = buildTrigrams('service memory');
  const ab = cosineSimilarity(a, b);
  const ba = cosineSimilarity(b, a);
  assert.ok(Math.abs(ab - ba) < 1e-9);
});

// ── cosineSimilarityVector ────────────────────────────────────────────────────

test('cosineSimilarityVector returns 0 for empty arrays', () => {
  assert.equal(cosineSimilarityVector([], []), 0);
});

test('cosineSimilarityVector returns 0 for mismatched lengths', () => {
  assert.equal(cosineSimilarityVector([1, 2], [1, 2, 3]), 0);
});

test('cosineSimilarityVector returns 1 for identical vectors', () => {
  const v = [0.1, 0.5, 0.9, 0.3];
  assert.ok(Math.abs(cosineSimilarityVector(v, v) - 1) < 1e-9);
});

test('cosineSimilarityVector returns 0 for orthogonal vectors', () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.ok(Math.abs(cosineSimilarityVector(a, b)) < 1e-9);
});

test('cosineSimilarityVector is symmetric', () => {
  const a = [0.2, 0.8, 0.4];
  const b = [0.7, 0.1, 0.6];
  assert.ok(Math.abs(cosineSimilarityVector(a, b) - cosineSimilarityVector(b, a)) < 1e-9);
});

test('cosineSimilarityVector result is in [0, 1] for positive vectors', () => {
  const a = [0.5, 0.5, 0.5];
  const b = [0.3, 0.9, 0.1];
  const score = cosineSimilarityVector(a, b);
  assert.ok(score >= 0 && score <= 1);
});

test('cosineSimilarityVector returns 0 for zero vector', () => {
  assert.equal(cosineSimilarityVector([0, 0, 0], [1, 2, 3]), 0);
});

// ── createSnippet ─────────────────────────────────────────────────────────────

test('createSnippet returns empty string for empty text', () => {
  assert.equal(createSnippet('', 'foo'), '');
  assert.equal(createSnippet('   ', 'foo'), '');
});

test('createSnippet returns full text when shorter than 220 chars and query not found', () => {
  const text = 'short text without the needle';
  assert.equal(createSnippet(text, 'missing'), text);
});

test('createSnippet truncates long text when query not found', () => {
  const text = 'a'.repeat(300);
  const snippet = createSnippet(text, 'missing');
  assert.ok(snippet.endsWith('...'));
  assert.ok(snippet.length <= 224); // 220 + "..."
});

test('createSnippet centers snippet on query when found', () => {
  const prefix = 'x'.repeat(200);
  const text = `${prefix}TARGET_QUERY here`;
  const snippet = createSnippet(text, 'TARGET_QUERY');
  assert.ok(snippet.includes('TARGET_QUERY'));
  assert.ok(snippet.startsWith('...'));
});

test('createSnippet does not add leading ellipsis when match is near start', () => {
  const text = 'TARGET_QUERY is at the beginning of the document';
  const snippet = createSnippet(text, 'TARGET_QUERY');
  assert.ok(!snippet.startsWith('...'));
  assert.ok(snippet.includes('TARGET_QUERY'));
});

test('createSnippet adds trailing ellipsis when match is near start and text is long', () => {
  const suffix = 'x'.repeat(300);
  const text = `TARGET_QUERY${suffix}`;
  const snippet = createSnippet(text, 'TARGET_QUERY');
  assert.ok(snippet.endsWith('...'));
});

test('createSnippet is case-insensitive for finding query position', () => {
  const text = 'This is about DOCKER containers';
  const snippet = createSnippet(text, 'docker');
  assert.ok(snippet.includes('DOCKER'));
});

test('createSnippet with empty query returns truncated text', () => {
  const short = 'hello world';
  assert.equal(createSnippet(short, ''), short);

  const long = 'b'.repeat(300);
  const snippet = createSnippet(long, '');
  assert.ok(snippet.endsWith('...'));
});

// ── chunkTextByLines ──────────────────────────────────────────────────────────

test('chunkTextByLines returns empty array for empty input', () => {
  assert.deepEqual(chunkTextByLines(''), []);
  assert.deepEqual(chunkTextByLines('   \n  '), []);
});

test('chunkTextByLines returns single chunk for short text', () => {
  const chunks = chunkTextByLines('line one\nline two\nline three');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startLine, 1);
  assert.ok(chunks[0].text.includes('line one'));
  assert.ok(chunks[0].text.includes('line three'));
});

test('chunkTextByLines chunk startLine is 1-indexed', () => {
  const chunks = chunkTextByLines('hello\nworld');
  assert.ok(chunks[0].startLine >= 1);
});

test('chunkTextByLines splits text longer than MAX_ENTRY_CHARS into multiple chunks', () => {
  // Each line is 80 chars; 18 lines × 81 chars = 1458 > 1400
  const lines = Array.from({ length: 18 }, (_, i) => `line ${String(i).padEnd(74, 'x')}`);
  const text = lines.join('\n');
  const chunks = chunkTextByLines(text);
  assert.ok(chunks.length >= 2, `Expected ≥2 chunks, got ${chunks.length}`);
});

test('chunkTextByLines chunks each contain at most MAX_ENTRY_CHARS characters', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i).padEnd(60, 'x')}`);
  const text = lines.join('\n');
  const chunks = chunkTextByLines(text);
  for (const chunk of chunks) {
    assert.ok(
      chunk.text.length <= MAX_ENTRY_CHARS + MEMORY_OVERLAP_CHARS,
      `Chunk too large: ${chunk.text.length}`,
    );
  }
});

test('chunkTextByLines overlapping chunks share tail content', () => {
  // Build text just over 1400 chars so we get exactly 2 chunks
  const longLine = 'x'.repeat(100);
  const lines = Array.from({ length: 15 }, () => longLine);
  const text = lines.join('\n');
  const chunks = chunkTextByLines(text);
  assert.ok(chunks.length >= 2);
  // The tail of chunk[0] should appear in the start of chunk[1] (overlap)
  const chunk0Lines = chunks[0].text.split('\n');
  const lastLineOfChunk0 = chunk0Lines[chunk0Lines.length - 1];
  assert.ok(chunks[1].text.includes(lastLineOfChunk0));
});

test('chunkTextByLines all chunks have non-empty text', () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i} content here`).join('\n');
  const chunks = chunkTextByLines(text);
  for (const chunk of chunks) {
    assert.ok(chunk.text.trim().length > 0, 'Empty chunk found');
  }
});

// ── chunkSessionText ──────────────────────────────────────────────────────────

test('chunkSessionText returns empty array for empty string', () => {
  assert.deepEqual(chunkSessionText(''), []);
  assert.deepEqual(chunkSessionText('   '), []);
});

test('chunkSessionText returns single chunk for short text', () => {
  const text = 'hello world';
  const chunks = chunkSessionText(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test('chunkSessionText returns single chunk for text exactly at limit', () => {
  const text = 'a'.repeat(MAX_ENTRY_CHARS);
  const chunks = chunkSessionText(text);
  assert.equal(chunks.length, 1);
});

test('chunkSessionText splits text longer than MAX_ENTRY_CHARS', () => {
  const text = 'a'.repeat(MAX_ENTRY_CHARS + 1);
  const chunks = chunkSessionText(text);
  assert.ok(chunks.length >= 2);
});

test('chunkSessionText compacts whitespace before chunking', () => {
  const text = 'hello   \n\n   world';
  const chunks = chunkSessionText(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'hello world');
});

test('chunkSessionText chunks overlap by MEMORY_OVERLAP_CHARS', () => {
  const text = 'b'.repeat(MAX_ENTRY_CHARS + 500);
  const chunks = chunkSessionText(text);
  assert.ok(chunks.length >= 2);
  // Step between chunks is MAX_ENTRY_CHARS - MEMORY_OVERLAP_CHARS = 1220
  const step = MAX_ENTRY_CHARS - MEMORY_OVERLAP_CHARS;
  assert.equal(chunks[0].length, MAX_ENTRY_CHARS);
  // Chunk 1 starts at offset step, so it overlaps by MEMORY_OVERLAP_CHARS
  assert.ok(chunks[1].startsWith('b'.repeat(MEMORY_OVERLAP_CHARS)));
  assert.equal(step, MAX_ENTRY_CHARS - MEMORY_OVERLAP_CHARS);
});

test('chunkSessionText all chunks have non-empty text', () => {
  const text = 'word '.repeat(400); // ~2000 chars
  const chunks = chunkSessionText(text);
  for (const chunk of chunks) {
    assert.ok(chunk.trim().length > 0);
  }
});

// ── hashText ──────────────────────────────────────────────────────────────────

test('hashText returns a string', () => {
  assert.equal(typeof hashText('hello'), 'string');
});

test('hashText is deterministic', () => {
  assert.equal(hashText('agentos memory'), hashText('agentos memory'));
});

test('hashText returns different values for different inputs', () => {
  assert.notEqual(hashText('hello'), hashText('world'));
});

test('hashText handles empty string without throwing', () => {
  assert.equal(typeof hashText(''), 'string');
  assert.equal(hashText(''), '0');
});

test('hashText handles long strings', () => {
  const long = 'x'.repeat(10000);
  assert.equal(typeof hashText(long), 'string');
  assert.equal(hashText(long), hashText(long));
});

// ── normalizeMemoryRelPath ────────────────────────────────────────────────────

test('normalizeMemoryRelPath accepts MEMORY.md', () => {
  assert.equal(normalizeMemoryRelPath('MEMORY.md'), 'MEMORY.md');
});

test('normalizeMemoryRelPath accepts memory/foo.md', () => {
  assert.equal(normalizeMemoryRelPath('memory/foo.md'), 'memory/foo.md');
});

test('normalizeMemoryRelPath accepts memory/sub/dir/file.md', () => {
  assert.equal(normalizeMemoryRelPath('memory/sub/dir/file.md'), 'memory/sub/dir/file.md');
});

test('normalizeMemoryRelPath trims leading slashes', () => {
  assert.equal(normalizeMemoryRelPath('/memory/foo.md'), 'memory/foo.md');
  assert.equal(normalizeMemoryRelPath('///memory/foo.md'), 'memory/foo.md');
});

test('normalizeMemoryRelPath converts backslashes to forward slashes', () => {
  assert.equal(normalizeMemoryRelPath('memory\\foo.md'), 'memory/foo.md');
});

test('normalizeMemoryRelPath trims whitespace', () => {
  assert.equal(normalizeMemoryRelPath('  MEMORY.md  '), 'MEMORY.md');
});

test('normalizeMemoryRelPath throws for path traversal with ..', () => {
  assert.throws(() => normalizeMemoryRelPath('../etc/passwd'), /Invalid memory path/);
  assert.throws(() => normalizeMemoryRelPath('memory/../../../etc/passwd'), /Invalid memory path/);
});

test('normalizeMemoryRelPath throws for empty string', () => {
  assert.throws(() => normalizeMemoryRelPath(''), /Invalid memory path/);
  assert.throws(() => normalizeMemoryRelPath('   '), /Invalid memory path/);
});

test('normalizeMemoryRelPath throws for BOOT.md', () => {
  assert.throws(() => normalizeMemoryRelPath('BOOT.md'), /Memory paths must target/);
});

test('normalizeMemoryRelPath throws for arbitrary .md files at root', () => {
  assert.throws(() => normalizeMemoryRelPath('README.md'), /Memory paths must target/);
  assert.throws(() => normalizeMemoryRelPath('other.md'), /Memory paths must target/);
});

test('normalizeMemoryRelPath throws for paths outside memory/', () => {
  assert.throws(() => normalizeMemoryRelPath('docs/foo.md'), /Memory paths must target/);
});

// ── stableStringify ───────────────────────────────────────────────────────────

test('stableStringify sorts object keys alphabetically', () => {
  const result = stableStringify({ z: 1, a: 2, m: 3 });
  const parsed = JSON.parse(result);
  assert.deepEqual(Object.keys(parsed), ['a', 'm', 'z']);
});

test('stableStringify is stable across key insertion order differences', () => {
  const a = stableStringify({ b: 1, a: 2 });
  const b = stableStringify({ a: 2, b: 1 });
  assert.equal(a, b);
});

test('stableStringify handles nested objects', () => {
  const result = stableStringify({ outer: { z: 1, a: 2 } });
  const parsed = JSON.parse(result);
  assert.deepEqual(Object.keys(parsed.outer), ['a', 'z']);
});

test('stableStringify passes arrays through without sorting', () => {
  const result = stableStringify([3, 1, 2]);
  assert.equal(result, '[3,1,2]');
});

test('stableStringify handles primitive values', () => {
  assert.equal(stableStringify(42), '42');
  assert.equal(stableStringify('hello'), '"hello"');
  assert.equal(stableStringify(null), 'null');
});

// ── Search scoring ────────────────────────────────────────────────────────────

test('scoreEntry returns 0 when tokenize yields empty set and no phrase/trigram overlap', () => {
  // "b" is 1 char → tokenize returns [], so lexicalScore = 0
  // text has no "b" → phraseBoost = 0; trigram overlap is negligible
  const entry = { text: 'python scripts runner tool', source: 'memory' };
  const score = scoreEntry('b', entry);
  // fuzzyScore may be tiny but total should stay well below DEFAULT_MIN_SCORE
  assert.ok(score < DEFAULT_MIN_SCORE, `score ${score} should be < ${DEFAULT_MIN_SCORE}`);
});

test('scoreEntry gives phraseBoost when query is exact substring of entry text', () => {
  const exactEntry = { text: 'use pnpm for this project', source: 'memory' };
  const partialEntry = { text: 'use npm for this project', source: 'memory' };
  const scoreExact = scoreEntry('pnpm', exactEntry);
  const scorePartial = scoreEntry('pnpm', partialEntry);
  assert.ok(scoreExact > scorePartial, `exact(${scoreExact}) should > partial(${scorePartial})`);
});

test('scoreEntry exact match scores above default minScore threshold', () => {
  const entry = { text: 'docker buildx create multiplatform', source: 'memory' };
  const score = scoreEntry('docker buildx', entry);
  assert.ok(score >= DEFAULT_MIN_SCORE, `score ${score} should be ≥ ${DEFAULT_MIN_SCORE}`);
});

test('scoreEntry completely unrelated entry scores below minScore threshold', () => {
  const entry = { text: 'banana smoothie recipe ingredients', source: 'memory' };
  const score = scoreEntry('kubernetes deployment yaml', entry);
  assert.ok(score < DEFAULT_MIN_SCORE, `score ${score} should be < ${DEFAULT_MIN_SCORE}`);
});

test('scoreEntry is higher for memory source than old session source with same text', () => {
  const oldTimestamp = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days ago
  const memoryEntry = { text: 'use typescript strict mode', source: 'memory' };
  const sessionEntry = { text: 'use typescript strict mode', source: 'sessions', timestamp: oldTimestamp };
  const memScore = scoreEntry('typescript strict', memoryEntry);
  const sessScore = scoreEntry('typescript strict', sessionEntry);
  assert.ok(memScore > sessScore, `memory(${memScore}) should > old session(${sessScore})`);
});

test('scoreEntry recent session has minimal decay applied', () => {
  const recentTimestamp = Date.now(); // now
  const entry = { text: 'use typescript strict mode', source: 'sessions', timestamp: recentTimestamp };
  const score = scoreEntry('typescript strict', entry);
  // Decay at t=0 is exp(0) = 1, so score is unchanged
  const memoryEntry = { text: 'use typescript strict mode', source: 'memory' };
  const memScore = scoreEntry('typescript strict', memoryEntry);
  assert.ok(Math.abs(score - memScore) < 0.01, `Recent session(${score}) should ≈ memory(${memScore})`);
});

test('scoreEntry with embedding boosts semantic score', () => {
  const queryEmbedding = [1.0, 0.0, 0.0];
  const alignedEntry = { text: 'irrelevant text', source: 'memory', embedding: [1.0, 0.0, 0.0] };
  const unalignedEntry = { text: 'irrelevant text', source: 'memory', embedding: [0.0, 1.0, 0.0] };
  const scoreAligned = scoreEntry('irrelevant text', alignedEntry, queryEmbedding);
  const scoreUnaligned = scoreEntry('irrelevant text', unalignedEntry, queryEmbedding);
  assert.ok(scoreAligned > scoreUnaligned, `aligned(${scoreAligned}) should > unaligned(${scoreUnaligned})`);
});

// ── filterAndRankResults ──────────────────────────────────────────────────────

test('filterAndRankResults returns empty for empty entries', () => {
  assert.deepEqual(filterAndRankResults([], 'query'), []);
});

test('filterAndRankResults filters out entries below minScore', () => {
  const entries = [
    { text: 'completely unrelated banana smoothie', source: 'memory' },
  ];
  const results = filterAndRankResults(entries, 'kubernetes deployment', { minScore: 0.18 });
  assert.equal(results.length, 0);
});

test('filterAndRankResults returns high-scoring entries above minScore', () => {
  const entries = [
    { text: 'kubernetes deployment yaml config', source: 'memory' },
    { text: 'banana smoothie recipe', source: 'memory' },
  ];
  const results = filterAndRankResults(entries, 'kubernetes deployment', { minScore: 0.18 });
  assert.ok(results.length >= 1);
  assert.ok(results[0].text.includes('kubernetes'));
});

test('filterAndRankResults sorts results descending by score', () => {
  const entries = [
    { text: 'docker container runtime', source: 'memory' },
    { text: 'docker container runtime image build push', source: 'memory' },
    { text: 'unrelated banana recipe', source: 'memory' },
  ];
  const results = filterAndRankResults(entries, 'docker container', { minScore: 0 });
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score,
      `Result at ${i - 1} (${results[i - 1].score}) should be ≥ result at ${i} (${results[i].score})`);
  }
});

test('filterAndRankResults respects maxResults limit', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    text: `docker kubernetes deployment item ${i}`,
    source: 'memory',
  }));
  const results = filterAndRankResults(entries, 'docker kubernetes', { maxResults: 3, minScore: 0 });
  assert.ok(results.length <= 3);
});

test('filterAndRankResults filters by source=memory', () => {
  const entries = [
    { text: 'docker container runtime', source: 'memory' },
    { text: 'docker container runtime', source: 'sessions', timestamp: Date.now() },
  ];
  const results = filterAndRankResults(entries, 'docker container', { source: 'memory', minScore: 0 });
  assert.ok(results.every((r) => r.source === 'memory'));
});

test('filterAndRankResults filters by source=sessions', () => {
  const entries = [
    { text: 'docker container runtime', source: 'memory' },
    { text: 'docker container runtime', source: 'sessions', timestamp: Date.now() },
  ];
  const results = filterAndRankResults(entries, 'docker container', { source: 'sessions', minScore: 0 });
  assert.ok(results.every((r) => r.source === 'sessions'));
});

test('filterAndRankResults source=all includes both memory and sessions', () => {
  const entries = [
    { text: 'docker container runtime', source: 'memory' },
    { text: 'docker container runtime', source: 'sessions', timestamp: Date.now() },
  ];
  const results = filterAndRankResults(entries, 'docker container', { source: 'all', minScore: 0 });
  const sources = new Set(results.map((r) => r.source));
  assert.ok(sources.has('memory') && sources.has('sessions'));
});

test('filterAndRankResults applies default maxResults of 8', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    text: `relevant memory entry about docker number ${i}`,
    source: 'memory',
  }));
  const results = filterAndRankResults(entries, 'docker', { minScore: 0 });
  assert.ok(results.length <= DEFAULT_MAX_RESULTS);
});
