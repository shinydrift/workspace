import type { ThreadPostStatus, ThreadStatusEvent } from '../../shared/types';

/**
 * Maps a medium-agnostic ThreadStatusEvent to the status shown on the thread's current prompt post —
 * the Thread-view counterpart of the Slack reaction lifecycle (👀 → 🤖 / 🏛️ → ✅ / ❌). Pure so the
 * mapping can be unit-tested without the store's broadcaster/electron import chain.
 *
 * Returns `undefined` for transitional states (stopped/building/archived) so the last status stays put.
 */
export function deriveThreadPostStatus(
  payload: ThreadStatusEvent,
  councilPending: boolean
): ThreadPostStatus | undefined {
  if (payload.status === 'error') return 'error';
  if (payload.autopilotEnabled && (payload.autopilotState === 'thinking' || payload.autopilotState === 'sent')) {
    return councilPending ? 'council' : 'autopilot';
  }
  if (payload.status === 'running') return 'working';
  if (payload.status === 'idle') return 'done';
  return undefined;
}
