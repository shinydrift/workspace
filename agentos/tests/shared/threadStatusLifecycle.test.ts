/**
 * Real-import tests for the single source of truth: shared/threadStatusLifecycle.ts.
 *
 * This module owns the whole agent-status lifecycle (👀 working → 🤖 autopilot / 🏛️ council →
 * ✅ done / ❌ error). broadcastStatus derives the indicator once from here; the renderer badge and
 * the Slack reaction echo render it as-is, so these tests pin the behavior every surface inherits.
 * Pure functions, no mocks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTerminalThreadPostStatus,
  deriveLiveThreadPostStatus,
  deriveThreadDisplayStatus,
  deriveThreadReactionEmoji,
  reconcileReaction,
  deriveStatusNotification,
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

test('live: user turn running with autopilot enabled → working (👀, not 🤖)', () => {
  // 🤖 marks autopilot's own activity; a user-initiated turn shows 👀 even while the toggle is on.
  assert.equal(deriveLiveThreadPostStatus('running', true, 'idle', false), 'working');
  assert.equal(deriveLiveThreadPostStatus('running', true, 'stopped', false), 'working');
});

test('live: autopilot-queued turn (thinking/sent) → autopilot', () => {
  assert.equal(deriveLiveThreadPostStatus('running', true, 'thinking', false), 'autopilot');
  assert.equal(deriveLiveThreadPostStatus('running', true, 'sent', false), 'autopilot');
});

test('live: turn finished with autopilot enabled → holds 🤖 (skip ✅, loop may run more turns)', () => {
  for (const autopilotState of ['idle', 'thinking', 'sent'] as const) {
    assert.equal(deriveLiveThreadPostStatus('idle', true, autopilotState, false), 'autopilot');
  }
});

test('live: autopilot settled (stopped/blocked) → null (terminal ✅ takes over)', () => {
  assert.equal(deriveLiveThreadPostStatus('idle', true, 'stopped', false), null);
  assert.equal(deriveLiveThreadPostStatus('idle', true, 'blocked', false), null);
});

test('live: council pending → council, with or without autopilot', () => {
  assert.equal(deriveLiveThreadPostStatus('running', false, undefined, true), 'council');
  assert.equal(deriveLiveThreadPostStatus('idle', false, undefined, true), 'council');
  assert.equal(deriveLiveThreadPostStatus('idle', true, 'sent', true), 'council');
});

// ── Display (what every surface renders) ─────────────────────────────────────

test('display: council pending overrides an idle terminal — 🏛️ stays up while members deliberate', () => {
  assert.equal(deriveThreadDisplayStatus(event({ status: 'idle' }), true), 'council');
});

test('display: error wins over council pending', () => {
  assert.equal(deriveThreadDisplayStatus(event({ status: 'error' }), true), 'error');
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

test('echo: user turn with autopilot enabled → eyes; autopilot takes over after the turn', () => {
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'running', autopilotEnabled: true, autopilotState: 'idle' }), false),
    'eyes'
  );
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'idle', autopilotEnabled: true, autopilotState: 'idle' }), false),
    'robot_face'
  );
});

test('echo: autopilot planning/driving turns → robot_face', () => {
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'idle', autopilotEnabled: true, autopilotState: 'thinking' }), false),
    'robot_face'
  );
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'running', autopilotEnabled: true, autopilotState: 'sent' }), false),
    'robot_face'
  );
});

test('echo: council submitted → classical_building, even while the parent idles', () => {
  assert.equal(deriveThreadReactionEmoji(event({ status: 'idle' }), true), 'classical_building');
  assert.equal(
    deriveThreadReactionEmoji(event({ status: 'running', autopilotEnabled: true, autopilotState: 'sent' }), true),
    'classical_building'
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

test('reconcile: transition between transients → swap (only one reaction at a time)', () => {
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

// ── Notifications (deriveStatusNotification) ──────────────────────────────────

test('notify: working → done fires done on the settling edge', () => {
  assert.equal(deriveStatusNotification('working', event({ status: 'idle' }), 'done'), 'done');
});

test('notify: working → error fires error', () => {
  assert.equal(deriveStatusNotification('working', event({ status: 'error' }), 'error'), 'error');
});

test('notify: a repeat outcome (prev === next) stays silent — dedups idle/stopped churn', () => {
  assert.equal(deriveStatusNotification('done', event({ status: 'idle' }), 'done'), null);
  assert.equal(deriveStatusNotification('error', event({ status: 'error' }), 'error'), null);
});

test('notify: autopilot blocked is attention, even though its reaction is ✅', () => {
  const blocked = event({ status: 'idle', autopilotEnabled: true, autopilotState: 'blocked' });
  assert.equal(deriveStatusNotification('autopilot', blocked, 'done'), 'attention');
});

test('notify: still-working states (👀/🤖/🏛️) never notify', () => {
  assert.equal(deriveStatusNotification('done', event({ status: 'running' }), 'working'), null);
  assert.equal(deriveStatusNotification(null, event({ status: 'running' }), 'autopilot'), null);
  assert.equal(deriveStatusNotification('working', event({ status: 'running' }), 'council'), null);
});
