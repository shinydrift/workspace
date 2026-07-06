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

/**
 * Normalizes the long-lived thread session status into the per-turn status used by the reaction
 * lifecycle. A thread row can remain `running` while its PTY/container is alive even when no turn is
 * currently active; lifecycle badges must treat that quiet state as `idle`.
 */
export function normalizeThreadStatusForLifecycle(
  status: ThreadStatus,
  hasActiveTurn: boolean,
  queueDepth: number
): ThreadStatus {
  if (status !== 'running') return status;
  if (hasActiveTurn || queueDepth > 0) return status;
  return 'idle';
}

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
 * A running turn shows 👀 unless autopilot queued it (thinking/sent) — 🤖 marks autopilot's own
 * activity, not merely that the toggle is on. Between turns (the thread sits at `idle` with the loop
 * armed), an enabled autopilot holds 🤖 rather than resolving to ✅: the loop may run many turns, and ✅
 * only lands once it settles (stopped/blocked) — that path is terminal (see
 * deriveTerminalThreadPostStatus) and wins in display. The `idle` guard matters: transient startup
 * states (`building`/`stopped` while a user turn is queued) must not flash 🤖 before the turn reaches
 * `running` and resolves to 👀. A pending council run overrides everything: 🏛️ while members deliberate.
 */
export function deriveLiveThreadPostStatus(
  status: ThreadStatus,
  autopilotEnabled: boolean | undefined,
  autopilotState: AutopilotThreadState | undefined,
  councilPending: boolean
): LiveThreadPostStatus | null {
  if (councilPending) return 'council';
  if (status === 'running') {
    return autopilotState === 'thinking' || autopilotState === 'sent' ? 'autopilot' : 'working';
  }
  if (status === 'idle' && autopilotEnabled && autopilotState !== 'stopped' && autopilotState !== 'blocked')
    return 'autopilot';
  return null;
}

/**
 * The full display status for a status event — terminal wins, else the live transient status, else
 * null when the thread isn't doing anything resolvable. This is what every surface renders.
 * Exception: a pending council keeps 🏛️ up even when the parent thread idles (its turn ends right
 * after dispatch), resolving to the regular lifecycle once the run completes. ❌ still wins — an
 * errored thread can't service a council.
 */
export function deriveThreadDisplayStatus(
  payload: ThreadStatusEvent,
  councilPending: boolean
): ThreadPostStatus | null {
  if (councilPending && payload.status !== 'error') return 'council';
  return (
    deriveTerminalThreadPostStatus(payload) ??
    deriveLiveThreadPostStatus(payload.status, payload.autopilotEnabled, payload.autopilotState, councilPending)
  );
}

/** A thread event worth surfacing as a notification on a thread you're not looking at. */
export type ThreadNotificationKind = 'done' | 'error' | 'attention';

/**
 * Decides whether a status broadcast should raise a notification (unread badge / toast / native),
 * given the previously-shown display status (`prev`, the thread's persisted currentReaction) and the
 * event. Fires once on the settling edge: `next === prev` means the same outcome re-broadcast, so it
 * stays silent — this dedups the repeated idle/stopped events a finished turn emits. Autopilot
 * `blocked` is an attention signal (a human is needed) even though its persisted reaction is ✅.
 * Returns null while a turn is still working (👀/🤖/🏛️) or when nothing changed.
 */
export function deriveStatusNotification(
  prev: ThreadPostStatus | null | undefined,
  payload: ThreadStatusEvent,
  next: ThreadPostStatus | null
): ThreadNotificationKind | null {
  if (next === prev) return null;
  if (payload.autopilotState === 'blocked') return 'attention';
  if (next === 'done') return 'done';
  if (next === 'error') return 'error';
  return null;
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
 * and what the live status now wants (`desired`, null = no reaction). A settled ✅/❌ is sticky: it is
 * kept when the status goes quiet (`desired === null`) AND never downgraded by a transient 👀/🤖/🏛️ —
 * this mirrors the frozen terminal status on the thread-view post, so Slack can't drift back to working
 * after a turn settles. A terminal→terminal change (✅→❌) still applies. Pure so it stays testable.
 */
export function reconcileReaction(prev: string | undefined, desired: string | null): { remove?: string; add?: string } {
  if (!desired) {
    if (prev && !TERMINAL_THREAD_REACTION_EMOJI.has(prev)) return { remove: prev };
    return {};
  }
  if (prev === desired) return {};
  if (prev && TERMINAL_THREAD_REACTION_EMOJI.has(prev) && !TERMINAL_THREAD_REACTION_EMOJI.has(desired)) return {};
  return { ...(prev ? { remove: prev } : {}), add: desired };
}
