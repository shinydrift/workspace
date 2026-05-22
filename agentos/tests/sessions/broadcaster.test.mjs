/**
 * Tests for sessions/broadcaster.ts — registerTrayUpdateHook and tray hook invocation (inlined).
 * No Electron, no slackBridge dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined tray-hook state machine from broadcaster.ts ──────────────────────

function makeBroadcaster() {
  let trayUpdateHook = null;

  function registerTrayUpdateHook(cb) {
    trayUpdateHook = cb;
  }

  // Simulate the tray-hook invocation that happens in broadcastStatus,
  // broadcastRename, broadcastThreadCreated (each calls trayUpdateHook?.()).
  function invokeTrayHook() {
    trayUpdateHook?.();
  }

  return { registerTrayUpdateHook, invokeTrayHook };
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('invokeTrayHook with no hook registered does not throw', () => {
  const { invokeTrayHook } = makeBroadcaster();
  assert.doesNotThrow(() => invokeTrayHook());
});

test('registerTrayUpdateHook sets the hook and it gets called', () => {
  const { registerTrayUpdateHook, invokeTrayHook } = makeBroadcaster();
  let callCount = 0;
  registerTrayUpdateHook(() => { callCount++; });
  invokeTrayHook();
  assert.equal(callCount, 1);
});

test('hook is called every time invokeTrayHook is called', () => {
  const { registerTrayUpdateHook, invokeTrayHook } = makeBroadcaster();
  let callCount = 0;
  registerTrayUpdateHook(() => { callCount++; });
  invokeTrayHook();
  invokeTrayHook();
  invokeTrayHook();
  assert.equal(callCount, 3);
});

test('registerTrayUpdateHook replaces the previous hook', () => {
  const { registerTrayUpdateHook, invokeTrayHook } = makeBroadcaster();
  const firstCalls = [];
  const secondCalls = [];
  registerTrayUpdateHook(() => firstCalls.push(1));
  registerTrayUpdateHook(() => secondCalls.push(2));
  invokeTrayHook();
  assert.equal(firstCalls.length, 0);
  assert.equal(secondCalls.length, 1);
});

test('hook receives no arguments (void callback)', () => {
  const { registerTrayUpdateHook, invokeTrayHook } = makeBroadcaster();
  let receivedArgs;
  registerTrayUpdateHook((...args) => { receivedArgs = args; });
  invokeTrayHook();
  assert.deepEqual(receivedArgs, []);
});
