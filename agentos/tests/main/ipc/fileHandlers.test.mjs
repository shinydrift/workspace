/**
 * Tests for ipc/handlers/fileHandlers.ts — shared safeFilename helper and path confinement.
 *
 * Both upload and transcript:save now use the same safeFilename + assertContained guards.
 * Tests cover the shared logic inline (no TS loader available in node --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// ── safeFilename (shared helper in fileHandlers.ts) ───────────────────────────
// Mirrors: path.basename(raw), then rejects empty / '.' / '..'

function safeFilename(raw) {
  const name = path.basename(raw);
  if (!name || name === '.' || name === '..') throw new Error('Invalid filename');
  return name;
}

// ── assertContained (shared helper in fileHandlers.ts) ────────────────────────

function assertContained(dest, dir) {
  if (!path.resolve(dest).startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('Path escaped target directory');
  }
}

// ── safeFilename: strips path components ──────────────────────────────────────

test('safeFilename: plain name unchanged', () => {
  assert.equal(safeFilename('document.pdf'), 'document.pdf');
});
test('safeFilename: strips traversal', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
});
test('safeFilename: strips absolute path', () => {
  assert.equal(safeFilename('/absolute/path/file.txt'), 'file.txt');
});
test('safeFilename: strips subdirectory prefix', () => {
  assert.equal(safeFilename('subdir/file.txt'), 'file.txt');
});
test('safeFilename: preserves dots in name', () => {
  assert.equal(safeFilename('my.archive.tar.gz'), 'my.archive.tar.gz');
});

// ── safeFilename: rejects invalid names ───────────────────────────────────────

test('safeFilename: rejects empty string', () => {
  assert.throws(() => safeFilename(''), /Invalid filename/);
});
test('safeFilename: rejects "/" (empty basename)', () => {
  assert.throws(() => safeFilename('/'), /Invalid filename/);
});
test('safeFilename: rejects "."', () => {
  assert.throws(() => safeFilename('.'), /Invalid filename/);
});
test('safeFilename: rejects ".."', () => {
  assert.throws(() => safeFilename('..'), /Invalid filename/);
});
test('safeFilename: windows-style path on posix — basename unchanged, then allowed', () => {
  // On POSIX, backslash is not a path sep so the whole string is the basename.
  // It's a valid (if weird) filename and should not be rejected.
  assert.equal(safeFilename('uploads\\evil.txt'), 'uploads\\evil.txt');
});

// ── assertContained: resolve-check ───────────────────────────────────────────

test('assertContained: safe dest inside dir passes', () => {
  const dir = '/base/.agentos/uploads';
  assert.doesNotThrow(() => assertContained(path.join(dir, 'file.txt'), dir));
});
test('assertContained: escaping path throws', () => {
  const dir = '/base/.agentos/uploads';
  assert.throws(() => assertContained('/etc/passwd', dir), /Path escaped/);
});
test('assertContained: adjacent dir with shared prefix is rejected', () => {
  const dir = '/base/.agentos/transcripts';
  assert.throws(() => assertContained('/base/.agentos/transcripts-extra/evil.txt', dir), /Path escaped/);
});

// ── upload path construction (both helpers applied) ───────────────────────────

test('upload: normal filename passes both checks', () => {
  const dir = '/base/.agentos/uploads';
  const name = safeFilename('report.csv');
  assert.doesNotThrow(() => assertContained(path.join(dir, name), dir));
});
test('upload: traversal attempt — basename strips, resolve-check holds', () => {
  const dir = '/base/.agentos/uploads';
  const name = safeFilename('../../../etc/passwd');
  assert.equal(name, 'passwd');
  assert.doesNotThrow(() => assertContained(path.join(dir, name), dir));
});

// ── transcript:save — filename + resolve-check ───────────────────────────────

test('transcript: valid timestamp filename passes', () => {
  const dir = '/base/.agentos/transcripts';
  const name = safeFilename('2026-05-23T10-30-00.txt');
  assert.equal(name, '2026-05-23T10-30-00.txt');
  assert.doesNotThrow(() => assertContained(path.join(dir, name), dir));
});
test('transcript: traversal stripped then contained', () => {
  const dir = '/base/.agentos/transcripts';
  const name = safeFilename('../../etc/passwd');
  assert.equal(name, 'passwd');
  assert.doesNotThrow(() => assertContained(path.join(dir, name), dir));
});
test('transcript: empty filename rejected', () => {
  assert.throws(() => safeFilename(''), /Invalid filename/);
});
test('transcript: "." rejected', () => {
  assert.throws(() => safeFilename('.'), /Invalid filename/);
});
test('transcript: ".." rejected', () => {
  assert.throws(() => safeFilename('..'), /Invalid filename/);
});
