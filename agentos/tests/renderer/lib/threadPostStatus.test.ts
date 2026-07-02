import { test, expect } from 'vitest';
import { deriveLiveThreadPostStatus } from '../../../src/renderer/lib/threadPostStatus';

test('running with no autopilot → working', () => {
  expect(deriveLiveThreadPostStatus('running', false, undefined, false)).toBe('working');
});

test('idle with no autopilot → null (persisted terminal status shows instead)', () => {
  expect(deriveLiveThreadPostStatus('idle', false, undefined, false)).toBeNull();
});

test('autopilot thinking/sent → autopilot when no council pending', () => {
  expect(deriveLiveThreadPostStatus('running', true, 'thinking', false)).toBe('autopilot');
  expect(deriveLiveThreadPostStatus('idle', true, 'sent', false)).toBe('autopilot');
});

test('autopilot thinking/sent → council when a council run is pending', () => {
  expect(deriveLiveThreadPostStatus('running', true, 'thinking', true)).toBe('council');
});

test('autopilot enabled but resting → holds autopilot (defer), never reverts to working', () => {
  expect(deriveLiveThreadPostStatus('running', true, 'idle', false)).toBe('autopilot');
  expect(deriveLiveThreadPostStatus('idle', true, 'idle', false)).toBe('autopilot');
});

test('council pending only matters while autopilot is enabled', () => {
  // Autopilot off → council flag is ignored, falls through to thread status.
  expect(deriveLiveThreadPostStatus('running', false, undefined, true)).toBe('working');
  expect(deriveLiveThreadPostStatus('idle', false, undefined, true)).toBeNull();
});

test('non-running, non-autopilot states → null', () => {
  for (const status of ['stopped', 'building', 'archived', 'error'] as const) {
    expect(deriveLiveThreadPostStatus(status, false, undefined, false)).toBeNull();
  }
});
