import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  WorktreeWorkerClient,
  type WorktreeWorkerChild,
  type WorktreeLogFn,
} from '../../../src/main/utils/worktreeWorkerClient';
import { WorktreeWorkerCrashedError } from '../../../src/main/utils/worktreeIpc';

type OutboundMsg = { kind: 'request'; id: string; method: string; args: unknown };

// Minimal mock mirroring WorktreeWorkerChild, driving ready/response/exit timing deterministically.
function createMockChild() {
  const bus = new EventEmitter();
  const outbound: OutboundMsg[] = [];
  const child = {
    postMessage(msg: OutboundMsg): void {
      outbound.push(msg);
    },
    on(event: string, listener: (...args: unknown[]) => void): void {
      bus.on(event, listener);
    },
    once(event: string, listener: (...args: unknown[]) => void): void {
      bus.once(event, listener);
    },
    off(event: string, listener: (...args: unknown[]) => void): void {
      bus.off(event, listener);
    },
    kill(): void {
      child.killed = true;
      bus.emit('exit', 0);
    },
    killed: false,
  };
  return {
    child: child as unknown as WorktreeWorkerChild,
    outbound,
    emitReady: (): boolean => bus.emit('message', { kind: 'ready', ok: true }),
    emitResponse: (id: string, result: unknown): boolean => bus.emit('message', { kind: 'response', id, result }),
    emitError: (id: string, message: string): boolean =>
      bus.emit('message', { kind: 'response', id, error: { message } }),
    emitEvent: (channel: string, payload: unknown): boolean => bus.emit('message', { kind: 'event', channel, payload }),
    emitExit: (code = 1): boolean => bus.emit('exit', code),
    findRequest: (method: string): OutboundMsg | undefined => outbound.find((m) => m.method === method),
    isKilled: (): boolean => child.killed,
  };
}

type Harness = ReturnType<typeof createMockChild>;

function makeClient(onFork: (h: Harness) => void, log: WorktreeLogFn = () => {}) {
  let harness: Harness;
  const client = new WorktreeWorkerClient({
    entryPath: '/fake/worktreeWorker.js',
    forkFn: () => {
      harness = createMockChild();
      onFork(harness);
      return harness.child;
    },
    log,
  });
  return { client, getHarness: () => harness };
}

test('ensureStarted forks the worker and resolves after the ready handshake', async () => {
  const { client } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  await client.ensureStarted();
});

test('a call sends its method+args and resolves with the correlated response', async () => {
  const { client, getHarness } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  const pending = client.isWorktreeClean('/repo/wt');
  await new Promise((r) => setTimeout(r, 5));
  const req = getHarness().findRequest('isWorktreeClean');
  assert.ok(req, 'isWorktreeClean request should reach the worker');
  assert.deepEqual(req!.args, { worktreePath: '/repo/wt' });
  getHarness().emitResponse(req!.id, true);
  assert.equal(await pending, true);
});

test('a worker error response rejects the call with its message', async () => {
  const { client, getHarness } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  const pending = client.getTaskGitSummary('/project', { branch: 'main', worktreePath: null });
  await new Promise((r) => setTimeout(r, 5));
  const req = getHarness().findRequest('getTaskGitSummary');
  assert.ok(req);
  assert.deepEqual(req!.args, { projectPath: '/project', options: { branch: 'main', worktreePath: null } });
  getHarness().emitError(req!.id, 'git blew up');
  await assert.rejects(pending, (err: Error) => err.message === 'git blew up');
});

test('worker exit rejects in-flight calls with WorktreeWorkerCrashedError', async () => {
  const { client, getHarness } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  const pending = client.removeSessionWorktree('/repo/wt');
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(getHarness().findRequest('removeSessionWorktree'));
  getHarness().emitExit(137);
  await assert.rejects(pending, (err: Error) => err instanceof WorktreeWorkerCrashedError);
});

test('pruneOrphanWorktrees passes Sets as plain arrays across the IPC boundary', async () => {
  const { client, getHarness } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  const pending = client.pruneOrphanWorktrees(new Set(['/a', '/b']), new Set(['/proj']));
  await new Promise((r) => setTimeout(r, 5));
  const req = getHarness().findRequest('pruneOrphanWorktrees');
  assert.ok(req);
  assert.deepEqual(req!.args, { activeWorktreePaths: ['/a', '/b'], projectPaths: ['/proj'] });
  getHarness().emitResponse(req!.id, null);
  await pending;
});

test('worktree:log events are forwarded to the injected logger', async () => {
  const logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  const { client, getHarness } = makeClient(
    (h) => queueMicrotask(() => h.emitReady()),
    (level, message, meta) => logs.push({ level, message, meta })
  );
  await client.ensureStarted();
  getHarness().emitEvent('worktree:log', { level: 'warn', message: 'heads up', meta: { path: '/wt' } });
  assert.deepEqual(logs, [{ level: 'warn', message: 'heads up', meta: { path: '/wt' } }]);
});

test('shutdown kills the child', async () => {
  const { client, getHarness } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  await client.ensureStarted();
  await client.shutdown();
  assert.equal(getHarness().isKilled(), true);
});

test('calls after shutdown reject rather than spawning a new worker', async () => {
  const { client } = makeClient((h) => queueMicrotask(() => h.emitReady()));
  await client.ensureStarted();
  await client.shutdown();
  await assert.rejects(client.isWorktreeClean('/wt'), (err: Error) => err instanceof WorktreeWorkerCrashedError);
});
