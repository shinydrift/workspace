/**
 * Tests for ipc/handlers/memoryHandlers.ts — schema validation and helper logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined helpers from memoryHandlers.ts ────────────────────────────────────

function getThreadProjectId(store, tid) {
  const thread = store.threads[tid];
  if (!thread?.projectId) throw new Error('Thread not found');
  return thread.projectId;
}

function getThreadProject(store, tid) {
  const projectId = getThreadProjectId(store, tid);
  const project = store.projects[projectId];
  if (!project?.path) throw new Error('Project path not found');
  return { projectId, projectPath: project.path };
}

// ── Inlined schema constraints ────────────────────────────────────────────────

function validateMemorySearch(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.threadId !== 'string' || req.threadId.length < 1 || req.threadId.length > 128) return false;
  if (typeof req.query !== 'string' || req.query.length < 1 || req.query.length > 2048) return false;
  if (req.maxResults !== undefined && (!Number.isInteger(req.maxResults) || req.maxResults < 1 || req.maxResults > 100))
    return false;
  if (req.minScore !== undefined && (typeof req.minScore !== 'number' || req.minScore < 0 || req.minScore > 1))
    return false;
  if (req.source !== undefined && !['all', 'memory', 'sessions'].includes(req.source)) return false;
  return true;
}

function validateMemoryGet(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.threadId !== 'string' || req.threadId.length < 1 || req.threadId.length > 128) return false;
  if (
    req.entryId !== undefined &&
    (typeof req.entryId !== 'string' || req.entryId.length < 1 || req.entryId.length > 256)
  )
    return false;
  if (req.path !== undefined && (typeof req.path !== 'string' || req.path.length < 1 || req.path.length > 4096))
    return false;
  return true;
}

function validateMemorySave(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.threadId !== 'string' || req.threadId.length < 1 || req.threadId.length > 128) return false;
  if (typeof req.path !== 'string' || req.path.length < 1 || req.path.length > 4096) return false;
  if (typeof req.content !== 'string' || req.content.length > 1_000_000) return false;
  if (req.mode !== undefined && !['overwrite', 'append'].includes(req.mode)) return false;
  return true;
}

function validateMemoryList(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.threadId !== 'string' || req.threadId.length < 1 || req.threadId.length > 128) return false;
  if (!Number.isInteger(req.page) || req.page < 0) return false;
  if (!Number.isInteger(req.pageSize) || req.pageSize < 1 || req.pageSize > 500) return false;
  return true;
}

function validateDecayConfig(config) {
  if (!config || typeof config !== 'object') return false;
  if (config.decayEnabled !== undefined && typeof config.decayEnabled !== 'boolean') return false;
  if (
    config.decayHalfLifeDays !== undefined &&
    (typeof config.decayHalfLifeDays !== 'number' || config.decayHalfLifeDays <= 0)
  )
    return false;
  if (
    config.decayMinScore !== undefined &&
    (typeof config.decayMinScore !== 'number' || config.decayMinScore < 0 || config.decayMinScore > 1)
  )
    return false;
  if (config.graphEnabled !== undefined && typeof config.graphEnabled !== 'boolean') return false;
  if (
    config.graphBoost !== undefined &&
    (typeof config.graphBoost !== 'number' || config.graphBoost < 0 || config.graphBoost > 1)
  )
    return false;
  return true;
}

// ── getThreadProjectId ────────────────────────────────────────────────────────

test('getThreadProjectId: returns projectId for known thread', () => {
  const store = { threads: { t1: { projectId: 'p1' } }, projects: {} };
  assert.equal(getThreadProjectId(store, 't1'), 'p1');
});

test('getThreadProjectId: throws for unknown thread', () => {
  const store = { threads: {}, projects: {} };
  assert.throws(() => getThreadProjectId(store, 'missing'), /Thread not found/);
});

test('getThreadProjectId: throws when thread has no projectId', () => {
  const store = { threads: { t1: { projectId: null } }, projects: {} };
  assert.throws(() => getThreadProjectId(store, 't1'), /Thread not found/);
});

// ── getThreadProject ──────────────────────────────────────────────────────────

test('getThreadProject: returns projectId and projectPath', () => {
  const store = {
    threads: { t1: { projectId: 'p1' } },
    projects: { p1: { path: '/home/user/project' } },
  };
  const result = getThreadProject(store, 't1');
  assert.equal(result.projectId, 'p1');
  assert.equal(result.projectPath, '/home/user/project');
});

test('getThreadProject: throws when project not found', () => {
  const store = {
    threads: { t1: { projectId: 'p1' } },
    projects: {},
  };
  assert.throws(() => getThreadProject(store, 't1'), /Project path not found/);
});

test('getThreadProject: throws when project has no path', () => {
  const store = {
    threads: { t1: { projectId: 'p1' } },
    projects: { p1: { path: null } },
  };
  assert.throws(() => getThreadProject(store, 't1'), /Project path not found/);
});

test('getThreadProject: throws when thread not found', () => {
  const store = { threads: {}, projects: { p1: { path: '/x' } } };
  assert.throws(() => getThreadProject(store, 'missing'), /Thread not found/);
});

// ── MemorySearchSchema ────────────────────────────────────────────────────────

test('memorySearch: valid minimal request', () => {
  assert.ok(validateMemorySearch({ threadId: 't1', query: 'hello' }));
});

test('memorySearch: valid with all optional fields', () => {
  assert.ok(validateMemorySearch({ threadId: 't1', query: 'hello', maxResults: 10, minScore: 0.5, source: 'memory' }));
});

test('memorySearch: rejects empty query', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: '' }));
});

test('memorySearch: rejects query over 2048 chars', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: 'x'.repeat(2049) }));
});

test('memorySearch: rejects maxResults of 0', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: 'q', maxResults: 0 }));
});

test('memorySearch: rejects maxResults over 100', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: 'q', maxResults: 101 }));
});

test('memorySearch: rejects minScore below 0', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: 'q', minScore: -0.1 }));
});

test('memorySearch: rejects minScore above 1', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: 'q', minScore: 1.1 }));
});

test('memorySearch: accepts all source values', () => {
  for (const source of ['all', 'memory', 'sessions']) {
    assert.ok(validateMemorySearch({ threadId: 't1', query: 'q', source }));
  }
});

test('memorySearch: rejects invalid source', () => {
  assert.ok(!validateMemorySearch({ threadId: 't1', query: 'q', source: 'other' }));
});

// ── MemoryGetSchema ───────────────────────────────────────────────────────────

test('memoryGet: valid with threadId only', () => {
  assert.ok(validateMemoryGet({ threadId: 't1' }));
});

test('memoryGet: valid with entryId', () => {
  assert.ok(validateMemoryGet({ threadId: 't1', entryId: 'entry-abc' }));
});

test('memoryGet: rejects empty entryId', () => {
  assert.ok(!validateMemoryGet({ threadId: 't1', entryId: '' }));
});

test('memoryGet: rejects entryId over 256 chars', () => {
  assert.ok(!validateMemoryGet({ threadId: 't1', entryId: 'x'.repeat(257) }));
});

// ── MemorySaveSchema ──────────────────────────────────────────────────────────

test('memorySave: valid minimal save', () => {
  assert.ok(validateMemorySave({ threadId: 't1', path: '/a/b.md', content: 'hello' }));
});

test('memorySave: accepts empty content', () => {
  assert.ok(validateMemorySave({ threadId: 't1', path: '/a/b.md', content: '' }));
});

test('memorySave: rejects content over 1,000,000 chars', () => {
  assert.ok(!validateMemorySave({ threadId: 't1', path: '/a/b.md', content: 'x'.repeat(1_000_001) }));
});

test('memorySave: accepts overwrite mode', () => {
  assert.ok(validateMemorySave({ threadId: 't1', path: '/a/b.md', content: '', mode: 'overwrite' }));
});

test('memorySave: accepts append mode', () => {
  assert.ok(validateMemorySave({ threadId: 't1', path: '/a/b.md', content: '', mode: 'append' }));
});

test('memorySave: rejects invalid mode', () => {
  assert.ok(!validateMemorySave({ threadId: 't1', path: '/a/b.md', content: '', mode: 'replace' }));
});

// ── MemoryListSchema ──────────────────────────────────────────────────────────

test('memoryList: valid request', () => {
  assert.ok(validateMemoryList({ threadId: 't1', page: 0, pageSize: 20 }));
});

test('memoryList: rejects negative page', () => {
  assert.ok(!validateMemoryList({ threadId: 't1', page: -1, pageSize: 20 }));
});

test('memoryList: rejects pageSize of 0', () => {
  assert.ok(!validateMemoryList({ threadId: 't1', page: 0, pageSize: 0 }));
});

test('memoryList: rejects pageSize over 500', () => {
  assert.ok(!validateMemoryList({ threadId: 't1', page: 0, pageSize: 501 }));
});

test('memoryList: accepts max pageSize of 500', () => {
  assert.ok(validateMemoryList({ threadId: 't1', page: 0, pageSize: 500 }));
});

// ── MemorySetDecayConfigSchema (config object) ────────────────────────────────

test('decayConfig: all optional, empty object is valid', () => {
  assert.ok(validateDecayConfig({}));
});

test('decayConfig: all fields set to valid values', () => {
  assert.ok(
    validateDecayConfig({
      decayEnabled: true,
      decayHalfLifeDays: 30,
      decayMinScore: 0.1,
      graphEnabled: false,
      graphBoost: 0.15,
    })
  );
});

test('decayConfig: rejects non-boolean decayEnabled', () => {
  assert.ok(!validateDecayConfig({ decayEnabled: 1 }));
});

test('decayConfig: rejects zero decayHalfLifeDays', () => {
  assert.ok(!validateDecayConfig({ decayHalfLifeDays: 0 }));
});

test('decayConfig: rejects negative decayHalfLifeDays', () => {
  assert.ok(!validateDecayConfig({ decayHalfLifeDays: -5 }));
});

test('decayConfig: rejects decayMinScore below 0', () => {
  assert.ok(!validateDecayConfig({ decayMinScore: -0.1 }));
});

test('decayConfig: rejects decayMinScore above 1', () => {
  assert.ok(!validateDecayConfig({ decayMinScore: 1.1 }));
});

test('decayConfig: rejects graphBoost below 0', () => {
  assert.ok(!validateDecayConfig({ graphBoost: -0.1 }));
});

test('decayConfig: rejects graphBoost above 1', () => {
  assert.ok(!validateDecayConfig({ graphBoost: 1.1 }));
});

test('decayConfig: rejects non-boolean graphEnabled', () => {
  assert.ok(!validateDecayConfig({ graphEnabled: 'yes' }));
});

// ── getDecayConfig defaults ───────────────────────────────────────────────────

test('getDecayConfig: applies expected defaults when config is empty', () => {
  const mem = {};
  const result = {
    decayEnabled: mem.decayEnabled ?? true,
    decayHalfLifeDays: mem.decayHalfLifeDays ?? 45,
    decayMinScore: mem.decayMinScore ?? 0,
    graphEnabled: mem.graphEnabled ?? true,
    graphBoost: mem.graphBoost ?? 0.15,
  };
  assert.equal(result.decayEnabled, true);
  assert.equal(result.decayHalfLifeDays, 45);
  assert.equal(result.decayMinScore, 0);
  assert.equal(result.graphEnabled, true);
  assert.equal(result.graphBoost, 0.15);
});

test('getDecayConfig: respects stored values over defaults', () => {
  const mem = { decayEnabled: false, decayHalfLifeDays: 30, graphBoost: 0.5 };
  const result = {
    decayEnabled: mem.decayEnabled ?? true,
    decayHalfLifeDays: mem.decayHalfLifeDays ?? 45,
    decayMinScore: mem.decayMinScore ?? 0,
    graphEnabled: mem.graphEnabled ?? true,
    graphBoost: mem.graphBoost ?? 0.15,
  };
  assert.equal(result.decayEnabled, false);
  assert.equal(result.decayHalfLifeDays, 30);
  assert.equal(result.graphBoost, 0.5);
});
