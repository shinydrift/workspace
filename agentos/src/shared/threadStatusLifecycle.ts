import type {
  AutopilotThreadState,
  ThreadPostStatus,
  ThreadPostTerminalStatus,
  ThreadStatus,
  ThreadStatusEvent,
} from './types';

/**
 * The single source of truth for the agent status lifecycle shown on a thread's current prompt:
 * 👀 working → 🤖 autopilot / 🏛️ council → ✅ done / ❌ error.
 *
 * Every surface derives from here so they can't drift: the renderer badge renders the live status,
 * the thread-post store persists the terminal status, and Slack reactions are a pure echo that maps
 * the same computed status to an emoji. Pure (no electron/node imports) so it's importable from main,
 * renderer, and tests alike.
 */

/** The transient, non-persisted half of the lifecycle (👀 / 🤖 / 🏛️). */
export type LiveThreadPostStatus = Exclude<ThreadPostStatus, ThreadPostTerminalStatus>;

/**
 * Derives the TERMINAL status to persist on a thread's current prompt post (✅ done / ❌ error).
 * Returns `undefined` while a turn is still in progress so nothing is persisted yet — the transient
 * badge is derived live instead, so a turn left mid-flight (restart, interrupt) never sticks. For an
 * autopilot turn, "done" is only reached once autopilot settles (stopped/blocked); an idle between
 * autopilot turns is not terminal. Relies on the event carrying autopilot context (see _broadcast).
 */
export function deriveTerminalThreadPostStatus(payload: ThreadStatusEvent): ThreadPostTerminalStatus | undefined {
  if (payload.status === 'error') return 'error';
  if (payload.autopilotEnabled) {
    return payload.autopilotState === 'stopped' || payload.autopilotState === 'blocked' ? 'done' : undefined;
  }
  if (payload.status === 'idle') return 'done';
  return undefined;
}

/**
 * Derives the live status badge from the thread's current live state — the transient counterpart of
 * the persisted terminal status. Returns `null` when the thread isn't actively processing, so the
 * persisted ✅/❌ (or nothing) shows instead. Because it's recomputed from live state, it self-corrects
 * and never sticks across a restart or interrupt.
 *
 * While autopilot is enabled it holds 🤖 (the "defer" state) rather than flashing 👀 or clearing:
 * a thread's DB status stays `running` between turns, so without this a resting autopilot thread would
 * keep resolving to 👀 and never move on. The turn-complete ✅ takes over once autopilot settles
 * (stopped/blocked) — that path is terminal (see deriveTerminalThreadPostStatus) and wins in display.
 */
export function deriveLiveThreadPostStatus(
  status: ThreadStatus,
  autopilotEnabled: boolean | undefined,
  autopilotState: AutopilotThreadState | undefined,
  councilPending: boolean
): LiveThreadPostStatus | null {
  if (autopilotState === 'thinking' || autopilotState === 'sent') return councilPending ? 'council' : 'autopilot';
  if (autopilotEnabled) return 'autopilot';
  if (status === 'running') return 'working';
  return null;
}

/**
 * The full display status for a status event — terminal wins, else the live transient status, else
 * null when the thread isn't doing anything resolvable. This is what every surface renders.
 */
export function deriveThreadDisplayStatus(
  payload: ThreadStatusEvent,
  councilPending: boolean
): ThreadPostStatus | null {
  return (
    deriveTerminalThreadPostStatus(payload) ??
    deriveLiveThreadPostStatus(payload.status, payload.autopilotEnabled, payload.autopilotState, councilPending)
  );
}

/** Slack reaction emoji for each lifecycle status — the echo mapping. */
export const THREAD_STATUS_SLACK_EMOJI: Record<ThreadPostStatus, string> = {
  working: 'eyes',
  autopilot: 'robot_face',
  council: 'classical_building',
  done: 'white_check_mark',
  error: 'x',
};

/** The settled (terminal) reaction emoji — a turn that really finished (✅/❌). */
export const TERMINAL_THREAD_REACTION_EMOJI: ReadonlySet<string> = new Set([
  THREAD_STATUS_SLACK_EMOJI.done,
  THREAD_STATUS_SLACK_EMOJI.error,
]);

/** The Slack reaction a status event projects to, or null when no reaction should be shown. */
export function deriveThreadReactionEmoji(payload: ThreadStatusEvent, councilPending: boolean): string | null {
  const status = deriveThreadDisplayStatus(payload, councilPending);
  return status ? THREAD_STATUS_SLACK_EMOJI[status] : null;
}

/**
 * Decides how the reaction on a single message should change, given what's currently shown (`prev`)
 * and what the live status now wants (`desired`, null = no reaction). A settled ✅/❌ is kept when the
 * status goes quiet (`desired === null`) — the in-app badge keeps the persisted terminal too, so a
 * later idle/stopped/archived broadcast must not erase it. Pure so the reaction projection is testable.
 */
export function reconcileReaction(prev: string | undefined, desired: string | null): { remove?: string; add?: string } {
  if (!desired) {
    if (prev && !TERMINAL_THREAD_REACTION_EMOJI.has(prev)) return { remove: prev };
    return {};
  }
  if (prev === desired) return {};
  return { ...(prev ? { remove: prev } : {}), add: desired };
}
