import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { MemoryWorkerClient } from '../../../src/main/memory/workerClient';
import { MemoryIndexerCrashedError } from '../../../src/main/memory/worker/ipc';

// Minimal mock that mirrors the WorkerChild interface in workerClient.ts and
// lets the test drive ready/response/exit timing deterministically.
interface OutboundMsg {
  kind: 'request' | 'event';
  method?: string;
  id?: string;
  channel?: string;
  args?: unknown;
  payload?: unknown;
}

function createMockChild(opts: { autoInit?: boolean } = {}) {
  const bus = new EventEmitter();
  const outbound: OutboundMsg[] = [];
  const handle = {
    child: undefined as unknown as {
      postMessage(msg: OutboundMsg): void;
      on(event: string, listener: (...args: unknown[]) => void): void;
      once(event: string, listener: (...args: unknown[]) => void): void;
      off(event: string, listener: (...args: unknown[]) => void): void;
      kill(): void;
      killed: boolean;
    },
    emitReady(probe = { betterSqlite3: true, sqliteVec: true, nodeLlamaCpp: true, errors: [] }): void {
      bus.emit('message', { kind: 'ready', probe });
    },
    emitResponse(id: string, result: unknown): void {
      bus.emit('message', { kind: 'response', id, result });
    },
    emitEvent(channel: string, payload: unknown): void {
      bus.emit('message', { kind: 'event', channel, payload });
    },
    emitExit(code = 1): void {
      bus.emit('exit', code);
    },
    findRequest(method: string): OutboundMsg | undefined {
      return outbound.find((m) => m && m.kind === 'request' && m.method === method);
    },
  };
  const child = {
    postMessage(msg: OutboundMsg): void {
      outbound.push(msg);
      if (
        opts.autoInit &&
        msg.kind === 'request' &&
        (msg.method === '__init__' || msg.method === '__shutdown__' || msg.method === 'warmup')
      ) {
        queueMicrotask(() => handle.emitResponse(msg.id!, null));
      }
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
  handle.child = child;
  return Object.assign(handle, { outbound });
}

function makeClient(forkFn, overrides = {}) {
  return new MemoryWorkerClient({
    entryPath: '/fake/indexer.js',
    forkFn,
    subscribeSettings: () => () => {},
    snapshot: () => ({ settings: {}, projects: [], threads: [] }),
    log: () => {},
    broadcast: () => {},
    ...overrides,
  });
}

test('ensureStarted spawns the worker, awaits ready, sends __init__', async () => {
  let harness;
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn);
  const ready = client.ensureStarted('/home/test');
  // The init request lands after the ready handshake.
  await new Promise((r) => setTimeout(r, 5));
  const initReq = harness.findRequest('__init__');
  assert.ok(initReq, '__init__ request should be sent');
  assert.equal(initReq.args.homeDir, '/home/test');
  harness.emitResponse(initReq.id, null);
  await ready;
  assert.deepEqual(client.getReadyProbe(), {
    betterSqlite3: true,
    sqliteVec: true,
    nodeLlamaCpp: true,
    errors: [],
  });
});

test('call() resolves with response keyed by correlation id', async () => {
  let harness;
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn);
  await client.ensureStarted('/home/test');
  const initReq = harness.findRequest('__init__');
  harness.emitResponse(initReq.id, null);

  const pending = client.call('saveChunk', { x: 1 });
  await new Promise((r) => setTimeout(r, 1));
  const req = harness.findRequest('saveChunk');
  assert.ok(req, 'saveChunk request should reach the worker');
  harness.emitResponse(req.id, { chunkId: 'abc' });
  const result = await pending;
  assert.deepEqual(result, { chunkId: 'abc' });
});

test('worker exit rejects in-flight requests with MemoryIndexerCrashedError and respawns', async () => {
  let harness;
  let spawnCount = 0;
  const forkFn = () => {
    spawnCount += 1;
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn);
  await client.ensureStarted('/home/test');

  const inFlight = client.call('saveChunk', { x: 1 });
  await new Promise((r) => setTimeout(r, 1));
  // Worker dies mid-request.
  harness.emitExit(137);

  await assert.rejects(inFlight, (err) => err instanceof MemoryIndexerCrashedError);

  // First retry is at 1s — speed-poll until the second spawn lands.
  const deadline = Date.now() + 3000;
  while (spawnCount < 2 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(spawnCount, 2, 'worker should respawn after exit');

  // The respawned worker also receives its own ready + __init__.
  await new Promise((r) => setTimeout(r, 5));
  const reinitReq = harness.findRequest('__init__');
  assert.ok(reinitReq, 'respawned worker should be re-initialized');
});

test('shutdown sends __shutdown__ and kills the child', async () => {
  let harness;
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn);
  await client.ensureStarted('/home/test');
  const initReq = harness.findRequest('__init__');
  harness.emitResponse(initReq.id, null);

  const shutdownP = client.shutdown(500);
  await new Promise((r) => setTimeout(r, 1));
  const shutReq = harness.findRequest('__shutdown__');
  assert.ok(shutReq, '__shutdown__ request should be sent');
  harness.emitResponse(shutReq.id, null);
  await shutdownP;
  assert.equal(harness.child.killed, true, 'child should be killed after shutdown');
});

test('shutdown after worker already dead does not throw', async () => {
  let harness;
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn);
  await client.ensureStarted('/home/test');
  const initReq = harness.findRequest('__init__');
  harness.emitResponse(initReq.id, null);

  harness.emitExit(0);
  // shutdown after exit should resolve cleanly even though the child is gone.
  await client.shutdown(100);
});

test('per-call timeout rejects pending entry with MemoryIndexerCrashedError', async () => {
  let harness;
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn, { callTimeoutMs: 100 });
  await client.ensureStarted('/home/test');
  // Don't emit a response for this call — let the timeout fire.
  await assert.rejects(client.call('search', { q: 'x' }), (err) => err instanceof MemoryIndexerCrashedError);
});

test('respawn timer skips when a call() already triggered ensureStarted concurrently', async () => {
  let harness;
  let spawnCount = 0;
  const forkFn = () => {
    spawnCount += 1;
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn);
  await client.ensureStarted('/home/test');
  assert.equal(spawnCount, 1);
  // Crash + fire a call() that races with the respawn timer. The call's
  // ensureStarted runs synchronously and sets startingPromise; when the respawn
  // timer fires later it should see startingPromise and skip the second spawn.
  harness.emitExit(137);
  const callP = client.call('search', { q: 'x' });
  await new Promise((r) => setTimeout(r, 1200));
  // exactly one extra spawn — from the call(), not duplicated by the respawn timer.
  assert.equal(spawnCount, 2, 'respawn timer should not spawn a duplicate worker');
  // The call() should reach the new worker. Respond so it resolves.
  const searchReq = harness.findRequest('search');
  if (searchReq) harness.emitResponse(searchReq.id, []);
  await callP;
});

test('snapshot push is skipped when projects/threads have not changed', async () => {
  let harness;
  const projects = [{ id: 'p1', name: 'p1', path: '/p1' }];
  const threads = [{ id: 't1', name: 't1', projectId: 'p1' }];
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn, {
    snapshot: () => ({ settings: {}, projects, threads }),
  });
  await client.ensureStarted('/home/test');
  // Init already pushed the initial snapshot via __init__. Second call() should
  // not re-push projects/threads events since the array references are the same.
  const before = harness.outbound.filter((m) => m.kind === 'event' && m.channel?.startsWith('runtime:projects')).length;
  const before2 = harness.outbound.filter((m) => m.kind === 'event' && m.channel?.startsWith('runtime:threads')).length;
  const p = client.call('search', { q: 'x' });
  await new Promise((r) => setTimeout(r, 5));
  const req = harness.findRequest('search');
  harness.emitResponse(req.id, []);
  await p;
  const after = harness.outbound.filter((m) => m.kind === 'event' && m.channel?.startsWith('runtime:projects')).length;
  const after2 = harness.outbound.filter((m) => m.kind === 'event' && m.channel?.startsWith('runtime:threads')).length;
  assert.equal(after, before, 'projects snapshot should not be re-pushed when unchanged');
  assert.equal(after2, before2, 'threads snapshot should not be re-pushed when unchanged');
});

test('event channel forwards broadcasts and runtime:log entries', async () => {
  let harness;
  const broadcasts = [];
  const logs = [];
  const forkFn = () => {
    harness = createMockChild({ autoInit: true });
    queueMicrotask(() => harness.emitReady());
    return harness.child;
  };
  const client = makeClient(forkFn, {
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    log: (level, sub, msg, meta) => logs.push({ level, sub, msg, meta }),
  });
  await client.ensureStarted('/home/test');
  const initReq = harness.findRequest('__init__');
  harness.emitResponse(initReq.id, null);

  harness.emitEvent('event:memory:indexStatus', { projectId: 'p1', phase: 'memory', state: 'done' });
  harness.emitEvent('runtime:log', { level: 'warn', subsystem: 'memory', msg: 'hi', meta: { x: 1 } });

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].channel, 'event:memory:indexStatus');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'warn');
  assert.equal(logs[0].msg, 'hi');
});
