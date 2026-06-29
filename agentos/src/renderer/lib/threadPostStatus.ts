import type { AutopilotThreadState, ThreadStatus } from '../../shared/types';

/** The transient, non-persisted half of the Thread-view status lifecycle (👀 / 🤖 / 🏛️). */
export type LiveThreadPostStatus = 'working' | 'autopilot' | 'council';

/**
 * Derives the live status badge for the thread's current prompt from the thread's live state — the
 * transient counterpart of the persisted terminal status. Returns `null` when the thread isn't
 * actively processing, so the persisted ✅/❌ (or nothing) shows instead. Because it's recomputed
 * from live state, it self-corrects and never sticks across a restart or interrupt.
 */
export function deriveLiveThreadPostStatus(
  status: ThreadStatus,
  autopilotState: AutopilotThreadState | undefined,
  councilPending: boolean
): LiveThreadPostStatus | null {
  if (autopilotState === 'thinking' || autopilotState === 'sent') return councilPending ? 'council' : 'autopilot';
  if (status === 'running') return 'working';
  return null;
}
