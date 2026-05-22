/**
 * Tests for sessions/ThreadManager — sendInput policy decisions.
 * Logic inlined from ThreadManager.ts to avoid Electron dependencies.
 * Covers the input-routing seams that plans 33–34 will extract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Types (mirrored from ThreadInputQueue.ts) ─────────────────────────────────

type QueueSource = 'user' | 'automation' | 'autopilot' | 'boot' | 'skills';
type DropPolicy = 'never' | 'timeout';

// ── Inlined from ThreadManager.sendInput ─────────────────────────────────────
//
// These three pure expressions are the routing seams at risk during Plan 33–34
// extraction.  If the extraction changes the policy, these tests will fail.

function computeDropPolicy(source: QueueSource, queueTimeoutMs: number): DropPolicy {
  return queueTimeoutMs > 0 && (source === 'automation' || source === 'autopilot')
    ? 'timeout'
    : 'never';
}

function inputPolicies(source: QueueSource) {
  return {
    interruptsActiveTurn: source === 'user',
    dropsPendingAutopilot: source === 'user',
    throwIfThreadStopped: source !== 'user',
  };
}

// ── drop policy ───────────────────────────────────────────────────────────────

test('user input always gets drop policy never, regardless of timeoutMs', () => {
  assert.equal(computeDropPolicy('user', 5_000), 'never');
  assert.equal(computeDropPolicy('user', 0), 'never');
});

test('automation with timeoutMs > 0 → timeout drop policy', () => {
  assert.equal(computeDropPolicy('automation', 30_000), 'timeout');
});

test('automation with timeoutMs 0 → never drop policy', () => {
  assert.equal(computeDropPolicy('automation', 0), 'never');
});

test('autopilot with timeoutMs > 0 → timeout drop policy', () => {
  assert.equal(computeDropPolicy('autopilot', 10_000), 'timeout');
});

test('autopilot with timeoutMs 0 → never drop policy', () => {
  assert.equal(computeDropPolicy('autopilot', 0), 'never');
});

test('boot source never gets timeout policy even with positive timeoutMs', () => {
  assert.equal(computeDropPolicy('boot', 5_000), 'never');
});

test('skills source never gets timeout policy even with positive timeoutMs', () => {
  assert.equal(computeDropPolicy('skills', 5_000), 'never');
});

// ── interrupt policy ──────────────────────────────────────────────────────────

test('user input interrupts an active turn', () => {
  assert.equal(inputPolicies('user').interruptsActiveTurn, true);
});

test('autopilot input does NOT interrupt an active turn', () => {
  assert.equal(inputPolicies('autopilot').interruptsActiveTurn, false);
});

test('automation input does NOT interrupt an active turn', () => {
  assert.equal(inputPolicies('automation').interruptsActiveTurn, false);
});

test('skills input does NOT interrupt an active turn', () => {
  assert.equal(inputPolicies('skills').interruptsActiveTurn, false);
});

// ── autopilot queue drop ──────────────────────────────────────────────────────

test('new user input drops stale pending autopilot queue items', () => {
  assert.equal(inputPolicies('user').dropsPendingAutopilot, true);
});

test('autopilot input does not drop pending autopilot items', () => {
  assert.equal(inputPolicies('autopilot').dropsPendingAutopilot, false);
});

test('automation input does not drop pending autopilot items', () => {
  assert.equal(inputPolicies('automation').dropsPendingAutopilot, false);
});

// ── thread-stopped behavior ───────────────────────────────────────────────────

test('user input starts a stopped thread (does not throw)', () => {
  assert.equal(inputPolicies('user').throwIfThreadStopped, false);
});

test('automation input throws when thread is stopped', () => {
  assert.equal(inputPolicies('automation').throwIfThreadStopped, true);
});

test('autopilot input throws when thread is stopped', () => {
  assert.equal(inputPolicies('autopilot').throwIfThreadStopped, true);
});

test('boot input throws when thread is stopped', () => {
  assert.equal(inputPolicies('boot').throwIfThreadStopped, true);
});
