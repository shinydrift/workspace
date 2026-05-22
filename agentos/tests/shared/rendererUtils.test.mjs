/**
 * Tests for renderer/lib/utils.ts — getBaseName and getArgSummary.
 * cn() depends on clsx/tailwind-merge so it's excluded.
 * Functions inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from renderer/lib/utils.ts ───────────────────────────────────────

function getBaseName(value) {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function getArgSummary(name, args) {
  if (!args || typeof args !== 'object') return '';
  const a = args;
  if (typeof a.description === 'string') return a.description;
  if (typeof a.prompt === 'string') return a.prompt.length > 80 ? a.prompt.slice(0, 80) + '…' : a.prompt;
  if (typeof a.file_path === 'string') return a.file_path;
  if (typeof a.path === 'string') return a.path;
  if (typeof a.command === 'string') {
    const cmd = a.command;
    return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
  }
  if (typeof a.pattern === 'string') return a.pattern;
  if (typeof a.query === 'string') return a.query;
  if (typeof a.url === 'string') return a.url;
  return '';
}

// ── getBaseName ───────────────────────────────────────────────────────────────

test('getBaseName: undefined returns empty string', () => {
  assert.equal(getBaseName(undefined), '');
});

test('getBaseName: empty string returns empty string', () => {
  assert.equal(getBaseName(''), '');
});

test('getBaseName: unix path', () => {
  assert.equal(getBaseName('/foo/bar/baz.ts'), 'baz.ts');
});

test('getBaseName: trailing slash stripped', () => {
  assert.equal(getBaseName('/foo/bar/'), 'bar');
});

test('getBaseName: windows backslash path', () => {
  assert.equal(getBaseName('C:\\Users\\foo\\file.txt'), 'file.txt');
});

test('getBaseName: bare filename', () => {
  assert.equal(getBaseName('file.ts'), 'file.ts');
});

// ── getArgSummary ─────────────────────────────────────────────────────────────

test('getArgSummary: null args returns empty string', () => {
  assert.equal(getArgSummary('tool', null), '');
});

test('getArgSummary: non-object args returns empty string', () => {
  assert.equal(getArgSummary('tool', 'string'), '');
});

test('getArgSummary: prefers description', () => {
  assert.equal(getArgSummary('tool', { description: 'do stuff', prompt: 'ignored' }), 'do stuff');
});

test('getArgSummary: short prompt returned as-is', () => {
  assert.equal(getArgSummary('tool', { prompt: 'hello' }), 'hello');
});

test('getArgSummary: long prompt truncated at 80 chars', () => {
  const long = 'x'.repeat(100);
  const result = getArgSummary('tool', { prompt: long });
  assert.equal(result, 'x'.repeat(80) + '…');
});

test('getArgSummary: file_path returned when no description/prompt', () => {
  assert.equal(getArgSummary('tool', { file_path: '/some/file.ts' }), '/some/file.ts');
});

test('getArgSummary: path returned when no file_path', () => {
  assert.equal(getArgSummary('tool', { path: '/some/dir' }), '/some/dir');
});

test('getArgSummary: short command returned as-is', () => {
  assert.equal(getArgSummary('tool', { command: 'ls -la' }), 'ls -la');
});

test('getArgSummary: long command truncated at 80 chars', () => {
  const long = 'a'.repeat(100);
  const result = getArgSummary('tool', { command: long });
  assert.equal(result, 'a'.repeat(80) + '…');
});

test('getArgSummary: pattern returned', () => {
  assert.equal(getArgSummary('tool', { pattern: '**/*.ts' }), '**/*.ts');
});

test('getArgSummary: query returned', () => {
  assert.equal(getArgSummary('tool', { query: 'search term' }), 'search term');
});

test('getArgSummary: url returned', () => {
  assert.equal(getArgSummary('tool', { url: 'https://example.com' }), 'https://example.com');
});

test('getArgSummary: no known key returns empty string', () => {
  assert.equal(getArgSummary('tool', { unknown: 'value' }), '');
});

// ── relativeTime ──────────────────────────────────────────────────────────────

function relativeTime(ts) {
  const diffMs = Date.now() - ts;
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

test('relativeTime: very recent timestamp returns 1m minimum', () => {
  const now = Date.now();
  assert.equal(relativeTime(now), '1m');
});

test('relativeTime: 5 minutes ago returns 5m', () => {
  const now = Date.now();
  assert.equal(relativeTime(now - 5 * 60_000), '5m');
});

test('relativeTime: 59 minutes ago returns 59m', () => {
  const now = Date.now();
  assert.equal(relativeTime(now - 59 * 60_000), '59m');
});

test('relativeTime: 1 hour ago returns 1h', () => {
  const now = Date.now();
  assert.equal(relativeTime(now - 60 * 60_000), '1h');
});

test('relativeTime: 23 hours ago returns 23h', () => {
  const now = Date.now();
  assert.equal(relativeTime(now - 23 * 60 * 60_000), '23h');
});

test('relativeTime: 1 day ago returns 1d', () => {
  const now = Date.now();
  assert.equal(relativeTime(now - 24 * 60 * 60_000), '1d');
});

test('relativeTime: 7 days ago returns 7d', () => {
  const now = Date.now();
  assert.equal(relativeTime(now - 7 * 24 * 60 * 60_000), '7d');
});
