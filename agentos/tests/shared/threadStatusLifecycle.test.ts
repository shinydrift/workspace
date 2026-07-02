/**
 * Real-import tests for the single source of truth: shared/threadStatusLifecycle.ts.
 *
 * This module owns the whole agent-status lifecycle (👀 working → 🤖 autopilot / 🏛️ council →
 * ✅ done / ❌ error). The renderer badge, the persisted terminal status, and the Slack reaction echo
 * all derive from here, so these tests pin the behavior every surface inherits. Pure functions, no mocks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTerminalThreadPostStatus,
  deriveLiveThreadPostStatus,
  deriveThreadReactionEmoji,
  reconcileReaction,
} from '../../src/shared/threadStatusLifecycle';
import type { ThreadStatusEvent } from '../../src/shared/types';

function event(overrides: Partial<ThreadStatusEvent> = {}): ThreadStatusEvent {
  return { threadId: 't1', status: 'running', ...overrides };
}

// ── Terminal (persisted ✅/❌) ─────────────────────────────────────────────────

test('terminal: running → not terminal', () => {
  assert.equal(deriveTerminalThreadPostStatus(event({ status: 'running' })), undefined);
});

test('terminal: idle without autopilot → done', () => {
  assert.equal(deriveTerminalThreadPostStatus(event({ status: 'idle' })), 'done');
});

test('terminal: error → error, regardless of autopilot', () => {
  assert.equal(deriveTerminalThreadPostStatus(event({ status: 'error' })), 'error');
  assert.equal(
    deriveTerminalThreadPostStatus(event({ status: 'error', autopilotEnabled: true, autopilotState: 'thinking' })),
    'error'
  );
});

test('terminal: autopilot mid-loop is not terminal — even on an intermediate idle', () => {
  for (const autopilotState of ['thinking', 'sent', 'idle'] as const) {
    assert.equal(
      deriveTerminalThreadPostStatus(event({ status: 'idle', autopilotEnabled: true, autopilotState })),
      undefined,
      `autopilotState=${autopilotState} should not persist done`
    );
  }
});

test('terminal: autopilot settled (stopped/blocked) → done', () => {
  for (const autopilotState of ['stopped', 'blocked'] as const) {
    assert.equal(
      deriveTerminalThreadPostStatus(event({ status: 'idle', autopilotEnabled: true, autopilotState })),
      'done'
    );
  }
});

// ── Live (transient 👀/🤖/🏛️) ─────────────────────────────────────────────────

test('live: running with no autopilot → working', () => {
  assert.equal(deriveLiveThreadPostStatus('running', false, undefined, false), 'working');
});

test('live: idle with no autopilot → null', () => {
  assert.equal(deriveLiveThreadPostStatus('idle', false, undefined, false), null);
});

test('live: autopilot thinking/sent → autopilot, or council when pending', () => {
  assert.equal(deriveLiveThreadPostStatus('running', true, 'thinking', false), 'autopilot');
  assert.equal(deriveLiveThreadPostStatus('idle', true, 'sent', false), 'autopilot');
  assert.equal(deriveLiveThreadPostStatus('running', true, 'thinking', true), 'council');
});

test('live: autopilot enabled but resting between turns → holds 🤖 (defer), not 👀/null', () => {
  assert.equal(deriveLiveThreadPostStatus('running', true, 'idle', false), 'autopilot');
  assert.equal(deriveLiveThreadPostStatus('idle', true, 'idle', false), 'autopilot');
});

test('live: council flag ignored when autopilot is not enabled', () => {
  assert.equal(deriveLiveThreadPostStatus('running', false, undefined, true), 'working');
  assert.equal(deriveLiveThreadPostStatus('idle', false, undefined, true), null);
});

// ── Slack reaction projection (the echo) ──────────────────────────────────────

test('echo: turn running, no autopilot → eyes', () => {
  assert.equal(deriveThreadReactionEmoji(event({ status: 'running' }), false), 'eyes');
});

test('echo: turn complete, no autopilot → white_check_mark', () => {
  assert.equal(deriveThreadReactionEmoji(event({ status: 'idle' }), false), 'white_check_mark');
});

test('echo: error → x', () => {
  assert.equal(deriveThreadReactionEmoji(event({ status: 'error' }), false), 'x');
});

test('echo: autopilot planning → robot_face, or classical_building when council pending', () => {
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'running', autopilotEnabled: true, autopilotState: 'thinking' }), false),
    'robot_face'
  );
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'running', autopilotEnabled: true, autopilotState: 'sent' }), true),
    'classical_building'
  );
});

test('echo: autopilot idle between turns → holds robot_face (deferred, not cleared to 👀 or nothing)', () => {
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'idle', autopilotEnabled: true, autopilotState: 'idle' }), false),
    'robot_face'
  );
  // A resting autopilot thread's DB status stays 'running' — must still hold 🤖, never revert to 👀.
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'running', autopilotEnabled: true, autopilotState: 'idle' }), false),
    'robot_face'
  );
});

test('echo: autopilot settled → white_check_mark (✅ deferred until autopilot stops)', () => {
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'idle', autopilotEnabled: true, autopilotState: 'stopped' }), false),
    'white_check_mark'
  );
});

// ── reconcileReaction: the projection delta (terminal-preserve is the key case) ──

test('reconcile: nothing shown, want a reaction → add it', () => {
  assert.deepEqual(reconcileReaction(undefined, 'eyes'), { add: 'eyes' });
});

test('reconcile: same reaction already shown → no-op', () => {
  assert.deepEqual(reconcileReaction('eyes', 'eyes'), {});
});

test('reconcile: transition between transients → swap', () => {
  assert.deepEqual(reconcileReaction('eyes', 'robot_face'), { remove: 'eyes', add: 'robot_face' });
});

test('reconcile: status goes quiet → clear a transient', () => {
  assert.deepEqual(reconcileReaction('eyes', null), { remove: 'eyes' });
  assert.deepEqual(reconcileReaction('robot_face', null), { remove: 'robot_face' });
});

test('reconcile: status goes quiet → KEEP a settled ✅/❌ (a later stopped/archived must not erase it)', () => {
  assert.deepEqual(reconcileReaction('white_check_mark', null), {});
  assert.deepEqual(reconcileReaction('x', null), {});
});

test('reconcile: a new turn replaces a settled ✅ with the live badge', () => {
  assert.deepEqual(reconcileReaction('white_check_mark', 'eyes'), { remove: 'white_check_mark', add: 'eyes' });
});
