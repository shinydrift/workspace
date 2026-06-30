import * as threadStore from '../threads/threadStore';
import { broadcastStatus } from './broadcaster';
import type { ThreadRuntimeStore } from './ThreadRuntimeStore';
import type { ThreadStatus, AutopilotThreadState, Provider } from '../../shared/types';

/**
 * Single write path for thread status transitions.
 * Every change to thread status in the DB is paired with an IPC broadcast,
 * eliminating the scattered threadStore.updateThread + broadcastStatus call sites.
 */
export class ThreadStateService {
  constructor(
    private readonly store: ThreadRuntimeStore,
    private readonly getQueueDepth: (threadId: string) => number
  ) {}

  getPid(threadId: string): number | undefined {
    return this.store.ptys.get(threadId)?.pid;
  }

  // Thread is setting up — container/env not yet ready
  setBuilding(threadId: string, provider: Provider): void {
    threadStore.updateThread(threadId, { status: 'building' });
    this._broadcast(threadId, 'building', { provider });
  }

  // PTY is live and accepting input
  setRunning(threadId: string, provider: Provider, pid: number): void {
    const now = Date.now();
    this.store.sessionStartedAts.set(threadId, now);
    threadStore.updateThread(threadId, { status: 'running', lastActiveAt: now });
    this._broadcast(threadId, 'running', { provider, pid });
  }

  // DB-only stop marker — used by shutdownThreadRuntime before the PTY exit event fires,
  // so the exit handler can read 'stopped' and avoid reclassifying SIGKILL as 'error'.
  setStoppedInDB(threadId: string): void {
    this.store.sessionStartedAts.delete(threadId);
    threadStore.updateThread(threadId, { status: 'stopped' });
  }

  // Broadcast 'stopped' without touching the DB — called after shutdownThreadRuntime
  // already wrote the DB but before the PTY exit event fires.
  broadcastStopped(threadId: string): void {
    this._broadcast(threadId, 'stopped');
  }

  // PTY exit handler: determines final status from exitCode, writes DB, and broadcasts.
  // Uses a conditional UPDATE (WHERE status != 'stopped') so a late exit signal from a
  // SIGKILL cannot overwrite a user-initiated 'stopped' that was already committed.
  setExited(threadId: string, exitCode: number | undefined): void {
    this.store.sessionStartedAts.delete(threadId);
    const status: ThreadStatus = exitCode === 0 ? 'stopped' : 'error';
    const changed = threadStore.updateThreadIfNotStatus(threadId, 'stopped', { status, exitCode: exitCode ?? null });
    if (!changed) return;
    this._broadcast(threadId, status, { exitCode });
  }

  setError(threadId: string, provider?: Provider): void {
    this.store.sessionStartedAts.delete(threadId);
    threadStore.updateThread(threadId, { status: 'error' });
    this._broadcast(threadId, 'error', { provider });
  }

  setArchived(threadId: string): void {
    threadStore.updateThread(threadId, { status: 'archived', archivedAt: Date.now() });
    this._broadcast(threadId, 'archived');
  }

  // Transient turn-complete state — not written to DB
  broadcastIdle(threadId: string): void {
    this._broadcast(threadId, 'idle');
  }

  // Used by AutopilotStateService to broadcast autopilot field changes without changing status
  broadcastAutopilotStatus(
    threadId: string,
    thread: {
      status: ThreadStatus;
      provider?: Provider;
      autopilotEnabled?: boolean;
      autopilotState?: AutopilotThreadState;
      autopilotLastReason?: string;
      autopilotConsecutiveTurns?: number;
    }
  ): void {
    broadcastStatus({
      threadId,
      status: thread.status,
      provider: thread.provider,
      pid: this.getPid(threadId),
      queueDepth: this.getQueueDepth(threadId),
      autopilotEnabled: thread.autopilotEnabled,
      autopilotState: thread.autopilotState,
      autopilotLastReason: thread.autopilotLastReason,
      autopilotConsecutiveTurns: thread.autopilotConsecutiveTurns,
      sessionStartedAt: this.store.sessionStartedAts.get(threadId),
    });
  }

  // Generic broadcast with optional overrides
  broadcastCurrentStatus(threadId: string, overrides?: { provider?: Provider; exitCode?: number }): void {
    const thread = threadStore.getThread(threadId);
    broadcastStatus({
      threadId,
      status: thread?.status ?? 'stopped',
      provider: overrides?.provider ?? thread?.provider,
      pid: this.getPid(threadId),
      exitCode: overrides?.exitCode,
      queueDepth: this.getQueueDepth(threadId),
      autopilotEnabled: thread?.autopilotEnabled,
      autopilotState: thread?.autopilotState,
      sessionStartedAt: this.store.sessionStartedAts.get(threadId),
    });
  }

  private _broadcast(
    threadId: string,
    status: ThreadStatus,
    extras?: { provider?: Provider; pid?: number; exitCode?: number }
  ): void {
    const thread = threadStore.getThread(threadId);
    broadcastStatus({
      threadId,
      status,
      provider: extras?.provider ?? thread?.provider,
      pid: extras?.pid ?? this.getPid(threadId),
      exitCode: extras?.exitCode,
      queueDepth: this.getQueueDepth(threadId),
      // Carry autopilot context on every status event so the lifecycle derivation (terminal badge +
      // Slack reaction echo) is self-describing — without it an idle/running event can't tell it's
      // mid-autopilot and resolves to the wrong icon.
      autopilotEnabled: thread?.autopilotEnabled,
      autopilotState: thread?.autopilotState,
      sessionStartedAt: this.store.sessionStartedAts.get(threadId),
    });
  }
}
