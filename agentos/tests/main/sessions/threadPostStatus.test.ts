/**
 * Real-import tests for sessions/threadPostStatus.ts — deriveThreadPostStatus.
 *
 * This derives only the TERMINAL status persisted on a prompt post (done/error). Transient
 * working/autopilot/council states are derived live in the renderer and must NOT be persisted here.
 * Pure function, no mocks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveThreadPostStatus } from '../../../src/main/sessions/threadPostStatus';
import type { ThreadStatusEvent } from '../../../src/shared/types';

function event(overrides: Partial<ThreadStatusEvent> = {}): ThreadStatusEvent {
  return { threadId: 't1', status: 'running', ...overrides };
}

test('running → not terminal (nothing persisted)', () => {
  assert.equal(deriveThreadPostStatus(event({ status: 'running' })), undefined);
});

test('idle → done (non-autopilot turn complete)', () => {
  assert.equal(deriveThreadPostStatus(event({ status: 'idle' })), 'done');
});

test('error → error, regardless of autopilot', () => {
  assert.equal(deriveThreadPostStatus(event({ status: 'error' })), 'error');
  assert.equal(
    deriveThreadPostStatus(event({ status: 'error', autopilotEnabled: true, autopilotState: 'thinking' })),
    'error'
  );
});

test('autopilot mid-loop is not terminal — even on an intermediate idle', () => {
  for (const autopilotState of ['thinking', 'sent', 'idle'] as const) {
    assert.equal(
      deriveThreadPostStatus(event({ status: 'idle', autopilotEnabled: true, autopilotState })),
      undefined,
      `autopilotState=${autopilotState} should not persist done`
    );
  }
});

test('autopilot settled → done', () => {
  for (const autopilotState of ['stopped', 'blocked'] as const) {
    assert.equal(deriveThreadPostStatus(event({ status: 'idle', autopilotEnabled: true, autopilotState })), 'done');
  }
});

test('transitional thread states are not terminal', () => {
  for (const status of ['stopped', 'building', 'archived'] as const) {
    assert.equal(deriveThreadPostStatus(event({ status })), undefined);
  }
});
