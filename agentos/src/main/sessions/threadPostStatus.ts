import type { ThreadPostTerminalStatus, ThreadStatusEvent } from '../../shared/types';

/**
 * Derives the TERMINAL status to persist on a thread's current prompt post from a medium-agnostic
 * ThreadStatusEvent — the durable half of the Slack reaction lifecycle (✅ done / ❌ error). The
 * transient working/autopilot/council badge is derived live in the renderer instead, so a turn left
 * mid-flight (restart, interrupt) never leaves a stuck spinner. Pure so it can be unit-tested without
 * the store's broadcaster/electron import chain.
 *
 * Returns `undefined` while a turn is still in progress so nothing is persisted yet. For an autopilot
 * turn, "done" is only reached once autopilot settles (stopped/blocked) — an idle between autopilot
 * turns is not terminal.
 */
export function deriveThreadPostStatus(payload: ThreadStatusEvent): ThreadPostTerminalStatus | undefined {
  if (payload.status === 'error') return 'error';
  if (payload.autopilotEnabled) {
    return payload.autopilotState === 'stopped' || payload.autopilotState === 'blocked' ? 'done' : undefined;
  }
  if (payload.status === 'idle') return 'done';
  return undefined;
}
