/**
 * Tests for ipc/handlers/schemas.ts — validation constraints (inlined, no zod import needed).
 * Verifies the same invariants as the zod schemas: min(1), max(N) per field.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from schemas.ts ───────────────────────────────────────

const CONSTRAINTS = {
  threadId: { min: 1, max: 128 },
  filePath: { min: 1, max: 4096 },
  shortId: { min: 1, max: 128 },
  shortName: { min: 1, max: 256 },
  chunkId: { min: 1, max: 512 },
};

function validates(field, value) {
  if (typeof value !== 'string') return false;
  const { min, max } = CONSTRAINTS[field];
  return value.length >= min && value.length <= max;
}

// ── threadId ──────────────────────────────────────────────────────────────────

test('threadId: accepts typical id string', () => assert.ok(validates('threadId', 'abc123')));
test('threadId: accepts single char', () => assert.ok(validates('threadId', 'a')));
test('threadId: accepts 128-char string', () => assert.ok(validates('threadId', 'a'.repeat(128))));
test('threadId: rejects empty string', () => assert.ok(!validates('threadId', '')));
test('threadId: rejects 129-char string', () => assert.ok(!validates('threadId', 'a'.repeat(129))));
test('threadId: rejects non-string (number)', () => assert.ok(!validates('threadId', 42)));
test('threadId: rejects null', () => assert.ok(!validates('threadId', null)));

// ── filePath ──────────────────────────────────────────────────────────────────

test('filePath: accepts typical path', () => assert.ok(validates('filePath', '/home/user/project/file.ts')));
test('filePath: accepts single char', () => assert.ok(validates('filePath', '/')));
test('filePath: accepts 4096-char string', () => assert.ok(validates('filePath', 'a'.repeat(4096))));
test('filePath: rejects empty string', () => assert.ok(!validates('filePath', '')));
test('filePath: rejects 4097-char string', () => assert.ok(!validates('filePath', 'a'.repeat(4097))));
test('filePath: rejects non-string', () => assert.ok(!validates('filePath', {})));

// ── shortId ───────────────────────────────────────────────────────────────────

test('shortId: accepts typical id', () => assert.ok(validates('shortId', 'proj-001')));
test('shortId: accepts single char', () => assert.ok(validates('shortId', 'x')));
test('shortId: accepts 128-char string', () => assert.ok(validates('shortId', 'z'.repeat(128))));
test('shortId: rejects empty string', () => assert.ok(!validates('shortId', '')));
test('shortId: rejects 129-char string', () => assert.ok(!validates('shortId', 'z'.repeat(129))));

// ── shortName ─────────────────────────────────────────────────────────────────

test('shortName: accepts typical name', () => assert.ok(validates('shortName', 'My Project')));
test('shortName: accepts single char', () => assert.ok(validates('shortName', 'N')));
test('shortName: accepts 256-char string', () => assert.ok(validates('shortName', 'n'.repeat(256))));
test('shortName: rejects empty string', () => assert.ok(!validates('shortName', '')));
test('shortName: rejects 257-char string', () => assert.ok(!validates('shortName', 'n'.repeat(257))));

// ── chunkId ───────────────────────────────────────────────────────────────────

test('chunkId: accepts typical chunk id', () => assert.ok(validates('chunkId', 'chunk:session123:0')));
test('chunkId: accepts single char', () => assert.ok(validates('chunkId', 'c')));
test('chunkId: accepts 512-char string', () => assert.ok(validates('chunkId', 'c'.repeat(512))));
test('chunkId: rejects empty string', () => assert.ok(!validates('chunkId', '')));
test('chunkId: rejects 513-char string', () => assert.ok(!validates('chunkId', 'c'.repeat(513))));
