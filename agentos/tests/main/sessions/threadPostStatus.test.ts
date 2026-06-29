/**
 * Real-import tests for sessions/threadPostStatus.ts — deriveThreadPostStatus.
 *
 * The mapping mirrors the Slack reaction lifecycle onto a thread's current prompt post. It's a pure
 * function with no dependencies, so it imports cleanly with no mocks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveThreadPostStatus } from '../../../src/main/sessions/threadPostStatus';
import type { ThreadStatusEvent } from '../../../src/shared/types';

function event(overrides: Partial<ThreadStatusEvent> = {}): ThreadStatusEvent {
  return { threadId: 't1', status: 'running', ...overrides };
}

test('running → working', () => {
  assert.equal(deriveThreadPostStatus(event({ status: 'running' }), false), 'working');
});

test('idle → done', () => {
  assert.equal(deriveThreadPostStatus(event({ status: 'idle' }), false), 'done');
});

test('error → error, regardless of autopilot', () => {
  assert.equal(deriveThreadPostStatus(event({ status: 'error' }), false), 'error');
  assert.equal(
    deriveThreadPostStatus(event({ status: 'error', autopilotEnabled: true, autopilotState: 'thinking' }), false),
    'error'
  );
});

test('autopilot pending → autopilot when no council', () => {
  for (const autopilotState of ['thinking', 'sent'] as const) {
    assert.equal(
      deriveThreadPostStatus(event({ status: 'running', autopilotEnabled: true, autopilotState }), false),
      'autopilot'
    );
  }
});

test('autopilot pending → council when a council run is pending', () => {
  assert.equal(
    deriveThreadPostStatus(event({ status: 'running', autopilotEnabled: true, autopilotState: 'thinking' }), true),
    'council'
  );
});

test('autopilot enabled but settled (stopped) falls through to thread status', () => {
  assert.equal(
    deriveThreadPostStatus(event({ status: 'idle', autopilotEnabled: true, autopilotState: 'stopped' }), false),
    'done'
  );
});

test('transitional states leave the prior status in place', () => {
  for (const status of ['stopped', 'building', 'archived'] as const) {
    assert.equal(deriveThreadPostStatus(event({ status }), false), undefined);
  }
});
