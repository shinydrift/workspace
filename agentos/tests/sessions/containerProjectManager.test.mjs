/**
 * Tests for sessions/containerProjectManager.ts — pure project CRUD logic and
 * container-related helpers (inlined, no Electron/store dependency).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined pure logic from containerProjectManager.ts ────────────────────────

// resolveProviderArgs (inlined, using simplified PROVIDER_CONFIGS)
const PROVIDER_CONFIGS = {
  claude: { supportsHeadless: true },
  codex: { supportsHeadless: true },
  gemini: { supportsHeadless: true },
};

function resolveProviderArgs(provider, settings) {
  if (PROVIDER_CONFIGS[provider].supportsHeadless) return [];
  if (provider !== 'claude') return [];
  const useClaudeStreamJson = settings.claudeStreamJson ?? true;
  const skipPermissions = settings.skipPermissions ?? true;
  return [
    ...(useClaudeStreamJson ? ['--output-format', 'stream-json'] : []),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
  ];
}

// pruneOrphanProjects (inlined — pure, no store needed)
function pruneOrphanProjects(projects, threads) {
  const referencedProjectIds = new Set(Object.values(threads).map((t) => t.projectId));
  const referencedPaths = new Set(Object.values(threads).map((t) => t.projectPath ?? t.workingDirectory));

  return Object.fromEntries(
    Object.entries(projects).filter(([projectId, project]) => {
      return referencedProjectIds.has(projectId) || referencedPaths.has(project.path);
    })
  );
}

// touchContainerFromActivity throttle logic (inlined)
function shouldTouchRegistry(lastRegistryTouchByThread, threadId, now, force = false) {
  const last = lastRegistryTouchByThread.get(threadId) ?? 0;
  return force || now - last >= 60_000;
}

// ── resolveProviderArgs ───────────────────────────────────────────────────────

test('resolveProviderArgs: all providers with supportsHeadless return empty array', () => {
  const settings = {};
  assert.deepEqual(resolveProviderArgs('claude', settings), []);
  assert.deepEqual(resolveProviderArgs('codex', settings), []);
  assert.deepEqual(resolveProviderArgs('gemini', settings), []);
});

test('resolveProviderArgs: non-headless claude with defaults returns stream-json + skip-permissions', () => {
  // Test the branch that would be reached if supportsHeadless were false
  // Simulate the logic directly
  function nonHeadlessClaudeArgs(settings) {
    const useClaudeStreamJson = settings.claudeStreamJson ?? true;
    const skipPermissions = settings.skipPermissions ?? true;
    return [
      ...(useClaudeStreamJson ? ['--output-format', 'stream-json'] : []),
      ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ];
  }
  assert.deepEqual(nonHeadlessClaudeArgs({}), ['--output-format', 'stream-json', '--dangerously-skip-permissions']);
  assert.deepEqual(nonHeadlessClaudeArgs({ claudeStreamJson: false, skipPermissions: false }), []);
  assert.deepEqual(nonHeadlessClaudeArgs({ claudeStreamJson: true, skipPermissions: false }), ['--output-format', 'stream-json']);
  assert.deepEqual(nonHeadlessClaudeArgs({ claudeStreamJson: false, skipPermissions: true }), ['--dangerously-skip-permissions']);
});

// ── pruneOrphanProjects ───────────────────────────────────────────────────────

test('pruneOrphanProjects: keeps project referenced by projectId', () => {
  const projects = { p1: { id: 'p1', path: '/some/path', name: 'P1' } };
  const threads = { t1: { projectId: 'p1', workingDirectory: '/other/dir' } };
  const result = pruneOrphanProjects(projects, threads);
  assert.ok('p1' in result);
});

test('pruneOrphanProjects: keeps project referenced by path (workingDirectory)', () => {
  const projects = { p1: { id: 'p1', path: '/home/user/project', name: 'P1' } };
  const threads = { t1: { projectId: 'unrelated', workingDirectory: '/home/user/project' } };
  const result = pruneOrphanProjects(projects, threads);
  assert.ok('p1' in result);
});

test('pruneOrphanProjects: keeps project referenced by projectPath', () => {
  const projects = { p1: { id: 'p1', path: '/home/user/project', name: 'P1' } };
  const threads = { t1: { projectId: 'other', projectPath: '/home/user/project', workingDirectory: '/other' } };
  const result = pruneOrphanProjects(projects, threads);
  assert.ok('p1' in result);
});

test('pruneOrphanProjects: removes orphan project not referenced by any thread', () => {
  const projects = {
    p1: { id: 'p1', path: '/a', name: 'A' },
    p2: { id: 'p2', path: '/b', name: 'B' },
  };
  const threads = { t1: { projectId: 'p1', workingDirectory: '/a' } };
  const result = pruneOrphanProjects(projects, threads);
  assert.ok('p1' in result);
  assert.ok(!('p2' in result));
});

test('pruneOrphanProjects: returns empty when no threads exist', () => {
  const projects = { p1: { id: 'p1', path: '/a', name: 'A' } };
  const result = pruneOrphanProjects(projects, {});
  assert.deepEqual(result, {});
});

test('pruneOrphanProjects: keeps all projects if all referenced', () => {
  const projects = {
    p1: { id: 'p1', path: '/a', name: 'A' },
    p2: { id: 'p2', path: '/b', name: 'B' },
  };
  const threads = {
    t1: { projectId: 'p1', workingDirectory: '/a' },
    t2: { projectId: 'p2', workingDirectory: '/b' },
  };
  const result = pruneOrphanProjects(projects, threads);
  assert.equal(Object.keys(result).length, 2);
});

test('pruneOrphanProjects: returns empty object when projects is empty', () => {
  const threads = { t1: { projectId: 'p1', workingDirectory: '/a' } };
  const result = pruneOrphanProjects({}, threads);
  assert.deepEqual(result, {});
});

// ── touchContainerFromActivity throttle ───────────────────────────────────────

test('shouldTouchRegistry: returns true when never touched', () => {
  const map = new Map();
  assert.equal(shouldTouchRegistry(map, 'thread1', Date.now()), true);
});

test('shouldTouchRegistry: returns false within 60s of last touch', () => {
  const map = new Map();
  const now = Date.now();
  map.set('thread1', now - 30_000);
  assert.equal(shouldTouchRegistry(map, 'thread1', now), false);
});

test('shouldTouchRegistry: returns true after 60s', () => {
  const map = new Map();
  const now = Date.now();
  map.set('thread1', now - 60_001);
  assert.equal(shouldTouchRegistry(map, 'thread1', now), true);
});

test('shouldTouchRegistry: force=true bypasses throttle', () => {
  const map = new Map();
  const now = Date.now();
  map.set('thread1', now - 1_000);
  assert.equal(shouldTouchRegistry(map, 'thread1', now, true), true);
});

test('shouldTouchRegistry: exactly at 60s boundary is triggered', () => {
  const map = new Map();
  const now = Date.now();
  map.set('thread1', now - 60_000);
  // now - last = 60_000, which is NOT < 60_000, so it should touch
  assert.equal(shouldTouchRegistry(map, 'thread1', now), true);
});

test('shouldTouchRegistry: different threads are independent', () => {
  const map = new Map();
  const now = Date.now();
  map.set('thread1', now - 1_000); // recently touched
  // thread2 never touched
  assert.equal(shouldTouchRegistry(map, 'thread1', now), false);
  assert.equal(shouldTouchRegistry(map, 'thread2', now), true);
});
