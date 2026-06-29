import { test, expect } from 'vitest';
import { deriveLiveThreadPostStatus } from '../../../src/renderer/lib/threadPostStatus';

test('running with no autopilot → working', () => {
  expect(deriveLiveThreadPostStatus('running', undefined, false)).toBe('working');
});

test('idle → null (persisted terminal status shows instead)', () => {
  expect(deriveLiveThreadPostStatus('idle', undefined, false)).toBeNull();
});

test('autopilot thinking/sent → autopilot when no council pending', () => {
  expect(deriveLiveThreadPostStatus('running', 'thinking', false)).toBe('autopilot');
  expect(deriveLiveThreadPostStatus('idle', 'sent', false)).toBe('autopilot');
});

test('autopilot thinking/sent → council when a council run is pending', () => {
  expect(deriveLiveThreadPostStatus('running', 'thinking', true)).toBe('council');
});

test('council pending only matters while autopilot is active', () => {
  // No active autopilot state → council flag is ignored, falls through to thread status.
  expect(deriveLiveThreadPostStatus('running', 'idle', true)).toBe('working');
  expect(deriveLiveThreadPostStatus('idle', undefined, true)).toBeNull();
});

test('non-running, non-autopilot states → null', () => {
  for (const status of ['stopped', 'building', 'archived', 'error'] as const) {
    expect(deriveLiveThreadPostStatus(status, undefined, false)).toBeNull();
  }
});
