/**
 * Tests for perfTrace.ts pure helper functions (inlined).
 *
 * Covers: summarizePath, summarizeSql, summarizeUrl, getErrorMessage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── summarizePath ─────────────────────────────────────────────────────────────

function summarizePath(value) {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.pathname || value.href;
  return '[unknown]';
}

test('summarizePath: string passthrough', () => {
  assert.equal(summarizePath('/foo/bar'), '/foo/bar');
});

test('summarizePath: empty string passthrough', () => {
  assert.equal(summarizePath(''), '');
});

test('summarizePath: URL with pathname', () => {
  const u = new URL('https://example.com/some/path?q=1');
  assert.equal(summarizePath(u), '/some/path');
});


test('summarizePath: non-string non-URL returns [unknown]', () => {
  assert.equal(summarizePath(42), '[unknown]');
  assert.equal(summarizePath(null), '[unknown]');
  assert.equal(summarizePath({}), '[unknown]');
});

// ── summarizeSql ──────────────────────────────────────────────────────────────

function summarizeSql(sql) {
  if (typeof sql !== 'string') return '[unknown]';
  const compact = sql.replace(/\s+/g, ' ').trim();
  return compact.length <= 140 ? compact : `${compact.slice(0, 137)}...`;
}

test('summarizeSql: non-string returns [unknown]', () => {
  assert.equal(summarizeSql(null), '[unknown]');
  assert.equal(summarizeSql(42), '[unknown]');
  assert.equal(summarizeSql(undefined), '[unknown]');
});

test('summarizeSql: collapses internal whitespace', () => {
  assert.equal(summarizeSql('SELECT  *\n  FROM  foo'), 'SELECT * FROM foo');
});

test('summarizeSql: trims leading/trailing whitespace', () => {
  assert.equal(summarizeSql('  SELECT 1  '), 'SELECT 1');
});

test('summarizeSql: short query returned as-is', () => {
  const short = 'SELECT * FROM foo WHERE id = ?';
  assert.equal(summarizeSql(short), short);
});

test('summarizeSql: exactly 140 chars not truncated', () => {
  const sql = 'x'.repeat(140);
  assert.equal(summarizeSql(sql), sql);
  assert.equal(summarizeSql(sql).length, 140);
});

test('summarizeSql: 141 chars truncated to 137 + ellipsis', () => {
  const sql = 'x'.repeat(141);
  const result = summarizeSql(sql);
  assert.equal(result, 'x'.repeat(137) + '...');
  assert.equal(result.length, 140);
});

test('summarizeSql: very long query truncated', () => {
  const sql = 'SELECT ' + 'a, '.repeat(200);
  const result = summarizeSql(sql);
  assert.equal(result.length, 140);
  assert.ok(result.endsWith('...'));
});

// ── summarizeUrl ──────────────────────────────────────────────────────────────

function summarizeUrl(input, init) {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET') ?? 'GET').toUpperCase();
  let raw = '';
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = input.url;

  try {
    const parsed = new URL(raw);
    return { method, url: `${parsed.origin}${parsed.pathname}` };
  } catch {
    return { method, url: raw };
  }
}

test('summarizeUrl: string input defaults to GET', () => {
  const result = summarizeUrl('https://api.example.com/v1/foo?bar=1');
  assert.equal(result.method, 'GET');
  assert.equal(result.url, 'https://api.example.com/v1/foo');
});

test('summarizeUrl: init.method overrides default', () => {
  const result = summarizeUrl('https://api.example.com/v1/foo', { method: 'POST' });
  assert.equal(result.method, 'POST');
});

test('summarizeUrl: method is uppercased', () => {
  const result = summarizeUrl('https://api.example.com/', { method: 'post' });
  assert.equal(result.method, 'POST');
});

test('summarizeUrl: URL instance used as input', () => {
  const u = new URL('https://api.example.com/v2/bar?x=1');
  const result = summarizeUrl(u);
  assert.equal(result.url, 'https://api.example.com/v2/bar');
  assert.equal(result.method, 'GET');
});

test('summarizeUrl: Request object uses .url and .method', () => {
  const req = new Request('https://api.example.com/v3/baz', { method: 'PUT' });
  const result = summarizeUrl(req);
  assert.equal(result.url, 'https://api.example.com/v3/baz');
  assert.equal(result.method, 'PUT');
});

test('summarizeUrl: query string stripped from URL', () => {
  const result = summarizeUrl('https://api.example.com/search?q=hello&page=2');
  assert.equal(result.url, 'https://api.example.com/search');
});

test('summarizeUrl: invalid URL returned as-is', () => {
  const result = summarizeUrl('not-a-url');
  assert.equal(result.url, 'not-a-url');
  assert.equal(result.method, 'GET');
});

// ── getErrorMessage ───────────────────────────────────────────────────────────

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

test('getErrorMessage: Error instance returns message', () => {
  assert.equal(getErrorMessage(new Error('boom')), 'boom');
});

test('getErrorMessage: string returns itself via String()', () => {
  assert.equal(getErrorMessage('oops'), 'oops');
});

test('getErrorMessage: number converted to string', () => {
  assert.equal(getErrorMessage(42), '42');
});

test('getErrorMessage: null becomes "null"', () => {
  assert.equal(getErrorMessage(null), 'null');
});

test('getErrorMessage: undefined becomes "undefined"', () => {
  assert.equal(getErrorMessage(undefined), 'undefined');
});

test('getErrorMessage: object uses String() representation', () => {
  assert.equal(getErrorMessage({ toString: () => 'custom' }), 'custom');
});
