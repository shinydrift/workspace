/**
 * Tests for autopilot/autopilotSubmission.ts — importing the REAL production module.
 *
 * The planner delivers its decision via the submit_autopilot_decision MCP tool, whose
 * handler builds a validated AutopilotAction and records it against a single-use token;
 * the adapter reads it by threadId once the planner exits.
 *
 * Run as part of test:ts (node --import tsx --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autopilotSubmissionRegistry,
  buildAutopilotDecision,
} from '../../../src/main/autopilot/autopilotSubmission.ts';

// ── buildAutopilotDecision (the validation that replaced parseAutopilotAction) ──

test('buildAutopilotDecision trims message and defaults missing reason', () => {
  assert.deepEqual(buildAutopilotDecision('send_message', '  Proceed.  ', undefined), {
    action: 'send_message',
    message: 'Proceed.',
    reason: 'No reason provided.',
  });
});

test('buildAutopilotDecision rejects empty/whitespace send_message', () => {
  assert.throws(() => buildAutopilotDecision('send_message', '   ', 'x'), /non-empty message/);
  assert.throws(() => buildAutopilotDecision('send_message', undefined, 'x'), /non-empty message/);
});

test('buildAutopilotDecision builds stop and ignores message', () => {
  assert.deepEqual(buildAutopilotDecision('stop', undefined, '  done  '), {
    action: 'stop',
    reason: 'done',
  });
});

// ── registry token binding ──────────────────────────────────────────────────

test('submit is rejected for an unknown token', () => {
  const ok = autopilotSubmissionRegistry.submit('no-such-token', { action: 'stop', reason: 'x' });
  assert.equal(ok, false);
});

test('open then submit-by-token records the decision for peek-by-thread', () => {
  autopilotSubmissionRegistry.open('t-1', 'tok-1');
  assert.equal(autopilotSubmissionRegistry.isOpen('t-1'), true);
  assert.equal(autopilotSubmissionRegistry.peek('t-1'), null);

  assert.equal(autopilotSubmissionRegistry.submit('tok-1', { action: 'stop', reason: 'r' }), true);
  assert.deepEqual(autopilotSubmissionRegistry.peek('t-1'), { action: 'stop', reason: 'r' });

  autopilotSubmissionRegistry.close('t-1');
  assert.equal(autopilotSubmissionRegistry.isOpen('t-1'), false);
  assert.equal(autopilotSubmissionRegistry.peek('t-1'), null);
});

test('a token cannot write into a different thread (no cross-thread injection)', () => {
  autopilotSubmissionRegistry.open('t-a', 'tok-a');
  autopilotSubmissionRegistry.open('t-b', 'tok-b');

  // Using t-a's token only ever writes t-a's slot, never t-b's.
  autopilotSubmissionRegistry.submit('tok-a', { action: 'send_message', message: 'hi', reason: 'r' });
  assert.deepEqual(autopilotSubmissionRegistry.peek('t-a'), { action: 'send_message', message: 'hi', reason: 'r' });
  assert.equal(autopilotSubmissionRegistry.peek('t-b'), null);

  autopilotSubmissionRegistry.close('t-a');
  autopilotSubmissionRegistry.close('t-b');
});

test('token is invalidated after close', () => {
  autopilotSubmissionRegistry.open('t-2', 'tok-2');
  autopilotSubmissionRegistry.close('t-2');
  assert.equal(autopilotSubmissionRegistry.submit('tok-2', { action: 'stop', reason: 'late' }), false);
});

test('re-opening a thread retires the previous token', () => {
  autopilotSubmissionRegistry.open('t-3', 'tok-old');
  autopilotSubmissionRegistry.open('t-3', 'tok-new');
  assert.equal(autopilotSubmissionRegistry.submit('tok-old', { action: 'stop', reason: 'stale' }), false);
  assert.equal(autopilotSubmissionRegistry.submit('tok-new', { action: 'stop', reason: 'fresh' }), true);
  assert.deepEqual(autopilotSubmissionRegistry.peek('t-3'), { action: 'stop', reason: 'fresh' });
  autopilotSubmissionRegistry.close('t-3');
});
