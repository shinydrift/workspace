import { test, expect } from 'vitest';
import { cn, getBaseName, timeAgo, relativeTime, getArgSummary } from '../../../src/renderer/lib/utils';

// ── cn ────────────────────────────────────────────────────────────────────────

test('cn: merges class names', () => {
  const result = cn('foo', 'bar');
  expect(result.includes('foo')).toBeTruthy();
  expect(result.includes('bar')).toBeTruthy();
});

test('cn: handles conditional classes', () => {
  expect(cn('a', false && 'b').includes('b')).toBeFalsy();
  expect(cn('a', true && 'b').includes('b')).toBeTruthy();
});

test('cn: handles undefined/null gracefully', () => {
  expect(() => cn(undefined, null, 'valid')).not.toThrow();
});

// ── getBaseName ───────────────────────────────────────────────────────────────

test('getBaseName: returns last path segment', () => {
  expect(getBaseName('/foo/bar/baz')).toBe('baz');
});

test('getBaseName: strips trailing slash', () => {
  expect(getBaseName('/foo/bar/')).toBe('bar');
});

test('getBaseName: handles Windows backslashes', () => {
  expect(getBaseName('C:\\Users\\me\\file.txt')).toBe('file.txt');
});

test('getBaseName: empty string → ""', () => {
  expect(getBaseName('')).toBe('');
});

test('getBaseName: undefined → ""', () => {
  expect(getBaseName(undefined)).toBe('');
});

test('getBaseName: filename only → the filename', () => {
  expect(getBaseName('file.ts')).toBe('file.ts');
});

test('getBaseName: handles multiple trailing slashes', () => {
  expect(getBaseName('/foo/bar///')).toBe('bar');
});

// ── timeAgo ───────────────────────────────────────────────────────────────────

test('timeAgo: < 1 minute → "just now"', () => {
  expect(timeAgo(Date.now() - 30_000)).toBe('just now');
});

test('timeAgo: minutes', () => {
  expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
});

test('timeAgo: hours', () => {
  expect(timeAgo(Date.now() - 3 * 3600_000)).toBe('3h ago');
});

test('timeAgo: days', () => {
  expect(timeAgo(Date.now() - 2 * 86_400_000)).toBe('2d ago');
});

// ── relativeTime ──────────────────────────────────────────────────────────────

test('relativeTime: < 1 hour → minutes', () => {
  const result = relativeTime(Date.now() - 30 * 60_000);
  expect(result.endsWith('m')).toBeTruthy();
});

test('relativeTime: sub-minute timestamp returns 1m', () => {
  expect(relativeTime(Date.now() - 30 * 1000)).toBe('1m');
});

test('relativeTime: future timestamp returns 1m (min clamp)', () => {
  expect(relativeTime(Date.now() + 60 * 1000)).toBe('1m');
});

test('relativeTime: < 1 day → hours', () => {
  const result = relativeTime(Date.now() - 5 * 3600_000);
  expect(result.endsWith('h')).toBeTruthy();
});

test('relativeTime: ≥ 1 day → days', () => {
  const result = relativeTime(Date.now() - 3 * 86_400_000);
  expect(result.endsWith('d')).toBeTruthy();
});

// ── getArgSummary ─────────────────────────────────────────────────────────────

test('getArgSummary: description field takes priority', () => {
  expect(getArgSummary('Tool', { description: 'do something', file_path: '/f' })).toBe('do something');
});

test('getArgSummary: file_path when no description/prompt', () => {
  expect(getArgSummary('Read', { file_path: '/src/main.ts' })).toBe('/src/main.ts');
});

test('getArgSummary: command field', () => {
  expect(getArgSummary('Bash', { command: 'npm test' })).toBe('npm test');
});

test('getArgSummary: truncates long command to 80 chars', () => {
  const cmd = 'x'.repeat(100);
  const result = getArgSummary('Bash', { command: cmd });
  expect(result.endsWith('…')).toBeTruthy();
  expect(result.length <= 83).toBeTruthy(); // 80 + '…'
});

test('getArgSummary: non-object args → ""', () => {
  expect(getArgSummary('Tool', null)).toBe('');
  expect(getArgSummary('Tool', 42)).toBe('');
});

test('getArgSummary: empty object → ""', () => {
  expect(getArgSummary('Tool', {})).toBe('');
});

test('getArgSummary: falls back to prompt', () => {
  expect(getArgSummary('Tool', { prompt: 'short prompt' })).toBe('short prompt');
});

test('getArgSummary: truncates long prompt at 80 chars with ellipsis', () => {
  const long = 'x'.repeat(100);
  const result = getArgSummary('Tool', { prompt: long });
  expect(result).toBe('x'.repeat(80) + '…');
});

test('getArgSummary: uses path', () => {
  expect(getArgSummary('Glob', { path: '/src' })).toBe('/src');
});

test('getArgSummary: uses pattern', () => {
  expect(getArgSummary('Grep', { pattern: '*.ts' })).toBe('*.ts');
});

test('getArgSummary: uses query', () => {
  expect(getArgSummary('Search', { query: 'find me' })).toBe('find me');
});

test('getArgSummary: uses url', () => {
  expect(getArgSummary('Fetch', { url: 'https://example.com' })).toBe('https://example.com');
});
