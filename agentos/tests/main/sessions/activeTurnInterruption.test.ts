import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadRuntimeStore } from '../../../src/main/sessions/ThreadRuntimeStore';
import { validateThreadPostTurnId } from '../../../src/main/sessions/threadPostTurnGuard';

test('activeTurns stores provider-neutral cancellation handles', () => {
  const store = new ThreadRuntimeStore();
  let cancelled = false;
  store.activeTurns.set('t1', { kind: 'interactive', input: 'old', cancel: () => (cancelled = true) });

  store.activeTurns.get('t1')?.cancel();

  assert.equal(cancelled, true);
});

test('clearThread removes active turn and post turn id', () => {
  const store = new ThreadRuntimeStore();
  store.activeTurns.set('t1', { kind: 'headless', input: 'old', cancel: () => {} });
  store.threadPostTurnIds.set('t1', 'turn-old');

  store.clearThread('t1');

  assert.equal(store.activeTurns.has('t1'), false);
  assert.equal(store.threadPostTurnIds.has('t1'), false);
});

test('thread post turn guard accepts current turn id', () => {
  assert.doesNotThrow(() => validateThreadPostTurnId('turn-current', 'turn-current'));
});

test('thread post turn guard rejects stale or missing active turn id', () => {
  assert.throws(() => validateThreadPostTurnId('turn-current', undefined), /Stale or missing turn_id/);
  assert.throws(() => validateThreadPostTurnId('turn-current', 'turn-old'), /Stale or missing turn_id/);
});

test('thread post turn guard rejects provided turn id after the turn is no longer active', () => {
  assert.throws(() => validateThreadPostTurnId(undefined, 'turn-old'), /Stale turn_id/);
});

test('thread post turn guard allows legacy callers when no turn is active', () => {
  assert.doesNotThrow(() => validateThreadPostTurnId(undefined, undefined));
});
