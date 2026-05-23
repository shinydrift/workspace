/**
 * Tests for ClaudeJsonlWatcher's settle-reason priority (inlined).
 *
 * The watcher decides how a turn ended from three observed flags
 * (endTurnSeen, systemMarkerSeen, pendingToolUseIds.size). That choice is what
 * gates whether autopilot fires after the turn — silence_fallback means the
 * turn didn't complete cleanly and the planner must be skipped.
 *
 * Only the priority logic is inlined; the fs/watcher plumbing is covered by
 * integration runs and is too coupled to electron-log to import here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from ClaudeJsonlWatcher.tailFile (settle function) ───────────────

/** @typedef {'end_turn' | 'system_marker' | 'silence_fallback'} TurnEndReason */

/**
 * @param {{ endTurnSeen: boolean; systemMarkerSeen: boolean }} flags
 * @returns {TurnEndReason}
 */
function pickSettleReason({ endTurnSeen, systemMarkerSeen }) {
  return endTurnSeen ? 'end_turn' : systemMarkerSeen ? 'system_marker' : 'silence_fallback';
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('end_turn wins over system_marker', () => {
  assert.equal(pickSettleReason({ endTurnSeen: true, systemMarkerSeen: true }), 'end_turn');
});

test('end_turn alone is end_turn', () => {
  assert.equal(pickSettleReason({ endTurnSeen: true, systemMarkerSeen: false }), 'end_turn');
});

test('system_marker alone is system_marker', () => {
  assert.equal(pickSettleReason({ endTurnSeen: false, systemMarkerSeen: true }), 'system_marker');
});

test('neither flag set is silence_fallback', () => {
  // This is the case that must suppress autopilot — the turn timed out on silence
  // without claude ever writing end_turn or a turn_duration system marker.
  assert.equal(pickSettleReason({ endTurnSeen: false, systemMarkerSeen: false }), 'silence_fallback');
});
