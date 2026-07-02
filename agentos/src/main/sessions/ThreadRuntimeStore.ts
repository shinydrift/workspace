import type { ThreadInjectionStatus, PersonalitySettings } from '../../shared/types';
import type { PtyProcess } from './PtyProcess';
import type { LaunchMode } from './turnExecution';

/**
 * Holds all per-thread runtime state maps.
 * Shared between ThreadLifecycle (writes on start/stop) and TurnExecutor (reads during turns),
 * replacing the per-map accessor-callback pattern.
 */
export class ThreadRuntimeStore {
  readonly ptys = new Map<string, PtyProcess>();
  readonly launchModes = new Map<string, LaunchMode>();
  readonly activeTurnProcs = new Map<string, { proc: PtyProcess; input: string }>();
  readonly injectionStatuses = new Map<string, ThreadInjectionStatus>();
  /** Threads whose active turn was killed by an incoming user message. Consumed by the interrupted turn and its follow-up. */
  readonly interruptedThreads = new Set<string>();
  /** Unix ms when the current PTY session started; in-memory only, cleared on stop/error. */
  readonly sessionStartedAts = new Map<string, number>();
  /** Per-thread personality overrides merged on top of project personality at boot. In-memory only. */
  readonly personalityOverrides = new Map<string, Partial<PersonalitySettings>>();
  /** In-flight teardown (stop + container cleanup) per thread; awaited by input dispatch so a turn doesn't race a tear-down. */
  readonly teardownInFlight = new Map<string, Promise<void>>();
  /** Threads with a (re)start in progress; checked by the exit-handler auto-prune so it never removes a worktree out from under a container that's starting up. */
  readonly startInFlight = new Set<string>();

  getInjectionStatus(threadId: string): ThreadInjectionStatus {
    return this.injectionStatuses.get(threadId) ?? { hasBoot: false, hasMemory: false, injected: false };
  }

  clearThread(threadId: string): void {
    this.ptys.delete(threadId);
    this.launchModes.delete(threadId);
    this.activeTurnProcs.delete(threadId);
    this.injectionStatuses.delete(threadId);
    this.interruptedThreads.delete(threadId);
    this.sessionStartedAts.delete(threadId);
    this.personalityOverrides.delete(threadId);
    this.teardownInFlight.delete(threadId);
    this.startInFlight.delete(threadId);
  }
}
