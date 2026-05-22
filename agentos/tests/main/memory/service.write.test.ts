/**
 * Tests for main/memory/service.ts — write-path logic.
 * Pure helpers inlined from AgentOSMemoryService to avoid Electron / SQLite
 * native-module dependencies.  Covers the behaviours at risk during plan 35
 * (memory service extraction).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined: projectStatsCache invalidation ───────────────────────────────────
//
// AgentOSMemoryService.invalidateProjectStats just calls
// this.projectStatsCache.delete(projectId).
// The cache read (getProjectStats) wraps entries in { data, expiry }.
// This exercises the round-trip behaviour.

type CacheEntry<T> = { data: T; expiry: number };

class ProjectStatsCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();

  set(projectId: string, data: T, now: number, ttlMs: number): void {
    this.map.set(projectId, { data, expiry: now + ttlMs });
  }

  get(projectId: string, now: number): T | undefined {
    const entry = this.map.get(projectId);
    if (!entry) return undefined;
    if (now > entry.expiry) {
      this.map.delete(projectId);
      return undefined;
    }
    return entry.data;
  }

  invalidate(projectId: string): void {
    this.map.delete(projectId);
  }

  has(projectId: string): boolean {
    return this.map.has(projectId);
  }
}

// ── statsCache: invalidation after write ──────────────────────────────────────

test('statsCache: invalidate removes the cached entry', () => {
  const cache = new ProjectStatsCache<{ chunkCount: number }>();
  const now = 1_000_000;
  cache.set('proj-1', { chunkCount: 5 }, now, 60_000);
  assert.ok(cache.get('proj-1', now) !== undefined);
  cache.invalidate('proj-1');
  assert.equal(cache.get('proj-1', now), undefined);
});

test('statsCache: invalidate for unknown project is a no-op', () => {
  const cache = new ProjectStatsCache<{ chunkCount: number }>();
  assert.doesNotThrow(() => cache.invalidate('unknown-project'));
});

test('statsCache: returns entry within TTL', () => {
  const cache = new ProjectStatsCache<{ chunkCount: number }>();
  const now = 1_000_000;
  cache.set('proj-1', { chunkCount: 3 }, now, 60_000);
  const result = cache.get('proj-1', now + 30_000);
  assert.ok(result !== undefined);
  assert.equal(result.chunkCount, 3);
});

test('statsCache: returns undefined after TTL expires', () => {
  const cache = new ProjectStatsCache<{ chunkCount: number }>();
  const now = 1_000_000;
  cache.set('proj-1', { chunkCount: 3 }, now, 60_000);
  const result = cache.get('proj-1', now + 60_001);
  assert.equal(result, undefined);
});

test('statsCache: expired entry is removed from the map on access', () => {
  const cache = new ProjectStatsCache<{ chunkCount: number }>();
  const now = 1_000_000;
  cache.set('proj-1', { chunkCount: 2 }, now, 60_000);
  cache.get('proj-1', now + 60_001); // triggers removal
  assert.equal(cache.has('proj-1'), false);
});

test('statsCache: multiple projects are independent', () => {
  const cache = new ProjectStatsCache<{ chunkCount: number }>();
  const now = 1_000_000;
  cache.set('proj-a', { chunkCount: 1 }, now, 60_000);
  cache.set('proj-b', { chunkCount: 2 }, now, 60_000);
  cache.invalidate('proj-a');
  assert.equal(cache.get('proj-a', now), undefined);
  assert.ok(cache.get('proj-b', now) !== undefined);
});

// ── Inlined: saveChunk parameter validation ───────────────────────────────────
//
// AgentOSMemoryService.saveChunk begins with:
//   const threadId = params.threadId?.trim();
//   if (!threadId) throw new Error('threadId is required to save a session chunk.');

function validateSaveChunkParams(params: { threadId?: string | null }): string {
  const threadId = params.threadId?.trim();
  if (!threadId) throw new Error('threadId is required to save a session chunk.');
  return threadId;
}

test('saveChunk: throws when threadId is empty string', () => {
  assert.throws(() => validateSaveChunkParams({ threadId: '' }), /threadId is required/);
});

test('saveChunk: throws when threadId is whitespace-only', () => {
  assert.throws(() => validateSaveChunkParams({ threadId: '   ' }), /threadId is required/);
});

test('saveChunk: throws when threadId is null', () => {
  assert.throws(() => validateSaveChunkParams({ threadId: null }), /threadId is required/);
});

test('saveChunk: throws when threadId is undefined', () => {
  assert.throws(() => validateSaveChunkParams({ threadId: undefined }), /threadId is required/);
});

test('saveChunk: accepts a valid threadId', () => {
  assert.doesNotThrow(() => validateSaveChunkParams({ threadId: 'thread-abc' }));
});

test('saveChunk: trims the returned threadId', () => {
  const result = validateSaveChunkParams({ threadId: '  thread-abc  ' });
  assert.equal(result, 'thread-abc');
});

// ── Inlined: normalizeMemoryRelPath validation ────────────────────────────────
//
// AgentOSMemoryService.save routes writes through normalizeMemoryRelPath which
// rejects directory-traversal paths and non-memory/ prefixes.

function normalizeMemoryRelPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error('Invalid memory path.');
  if (!normalized.includes('/') && normalized !== 'MEMORY.md') return `memory/${normalized}`;
  if (normalized !== 'MEMORY.md' && !normalized.startsWith('memory/')) {
    throw new Error('Memory paths must target MEMORY.md or memory/*.md.');
  }
  return normalized;
}

test('normalizeMemoryRelPath: bare filename gets memory/ prefix', () => {
  assert.equal(normalizeMemoryRelPath('user.md'), 'memory/user.md');
});

test('normalizeMemoryRelPath: MEMORY.md passes through unchanged', () => {
  assert.equal(normalizeMemoryRelPath('MEMORY.md'), 'MEMORY.md');
});

test('normalizeMemoryRelPath: memory/ prefixed path passes through', () => {
  assert.equal(normalizeMemoryRelPath('memory/user.md'), 'memory/user.md');
});

test('normalizeMemoryRelPath: strips leading slashes', () => {
  assert.equal(normalizeMemoryRelPath('/memory/user.md'), 'memory/user.md');
});

test('normalizeMemoryRelPath: rejects path traversal', () => {
  assert.throws(() => normalizeMemoryRelPath('../etc/passwd'), /Invalid memory path/);
});

test('normalizeMemoryRelPath: rejects paths outside memory/', () => {
  assert.throws(() => normalizeMemoryRelPath('src/something.md'), /must target/);
});
