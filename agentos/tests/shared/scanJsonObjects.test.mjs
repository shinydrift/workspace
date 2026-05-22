/**
 * Tests for shared/utils/scanJsonObjects.ts — scanJsonObjects
 * Logic inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from shared/utils/scanJsonObjects.ts ──────────────────────────────

function scanJsonObjects(text) {
  const objects = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('{', pos);
    if (start === -1) break;
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end === -1) break;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (typeof parsed === 'object' && parsed !== null) objects.push(parsed);
    } catch { /* skip malformed chunks */ }
    pos = end;
  }
  return objects;
}

// ── basic cases ───────────────────────────────────────────────────────────────

test('empty string returns empty array', () => {
  assert.deepEqual(scanJsonObjects(''), []);
});

test('no JSON objects returns empty array', () => {
  assert.deepEqual(scanJsonObjects('hello world'), []);
});

test('single simple object', () => {
  const result = scanJsonObjects('{"a":1}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { a: 1 });
});

test('single object with surrounding text', () => {
  const result = scanJsonObjects('prefix {"x":"y"} suffix');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { x: 'y' });
});

// ── multiple objects ──────────────────────────────────────────────────────────

test('two adjacent objects', () => {
  const result = scanJsonObjects('{"a":1}{"b":2}');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { a: 1 });
  assert.deepEqual(result[1], { b: 2 });
});

test('two objects separated by text', () => {
  const result = scanJsonObjects('{"a":1} some text {"b":2}');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { a: 1 });
  assert.deepEqual(result[1], { b: 2 });
});

test('three objects in sequence', () => {
  const result = scanJsonObjects('{"a":1}{"b":2}{"c":3}');
  assert.equal(result.length, 3);
});

// ── nested objects ────────────────────────────────────────────────────────────

test('nested object parsed correctly', () => {
  const result = scanJsonObjects('{"outer":{"inner":42}}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { outer: { inner: 42 } });
});

test('deeply nested object', () => {
  const result = scanJsonObjects('{"a":{"b":{"c":"deep"}}}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { a: { b: { c: 'deep' } } });
});

// ── string content with special characters ────────────────────────────────────

test('object with escaped quote in string value', () => {
  const result = scanJsonObjects('{"msg":"say \\"hello\\""}');
  assert.equal(result.length, 1);
  assert.equal(result[0].msg, 'say "hello"');
});

test('object with escaped backslash in string', () => {
  const result = scanJsonObjects('{"path":"C:\\\\Users\\\\foo"}');
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'C:\\Users\\foo');
});

test('object with brace chars inside string value', () => {
  const result = scanJsonObjects('{"template":"{ not a brace }"}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { template: '{ not a brace }' });
});

test('two objects where first contains braces in string', () => {
  const result = scanJsonObjects('{"a":"{}"}{"b":2}');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { a: '{}' });
  assert.deepEqual(result[1], { b: 2 });
});

// ── malformed / partial JSON ──────────────────────────────────────────────────

test('unclosed object returns empty array', () => {
  assert.deepEqual(scanJsonObjects('{"a":1'), []);
});

test('invalid JSON inside braces is skipped', () => {
  // malformed object followed by valid one
  const result = scanJsonObjects('{bad json}{"ok":true}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { ok: true });
});

test('only text with braces but no valid JSON', () => {
  assert.deepEqual(scanJsonObjects('{not json at all}'), []);
});

// ── non-object JSON types are excluded ───────────────────────────────────────

test('JSON array at top level is excluded', () => {
  // Arrays start with [ not {, so not parsed at all
  assert.deepEqual(scanJsonObjects('[1,2,3]'), []);
});

test('JSON primitive in braces (invalid) is skipped', () => {
  // "42" is valid JSON but not an object/non-null
  assert.deepEqual(scanJsonObjects('{"x":1}'), [{ x: 1 }]); // sanity
});

// ── arrays inside objects are preserved ──────────────────────────────────────

test('object with array value', () => {
  const result = scanJsonObjects('{"items":[1,2,3]}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { items: [1, 2, 3] });
});

// ── real-world stream-like input ──────────────────────────────────────────────

test('concatenated NDJSON-style objects', () => {
  const input = '{"type":"start","id":"abc"}{"type":"delta","text":"hello"}{"type":"end"}';
  const result = scanJsonObjects(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].type, 'start');
  assert.equal(result[1].type, 'delta');
  assert.equal(result[2].type, 'end');
});

test('objects embedded in log lines', () => {
  const input = '[2026-05-23] event {"level":"info","msg":"ok"} done\n[2026-05-23] {"level":"warn"}';
  const result = scanJsonObjects(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].level, 'info');
  assert.equal(result[1].level, 'warn');
});

test('empty object is included', () => {
  const result = scanJsonObjects('{}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {});
});

test('null value in object', () => {
  const result = scanJsonObjects('{"key":null}');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { key: null });
});
