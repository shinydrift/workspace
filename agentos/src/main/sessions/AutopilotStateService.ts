import * as threadStore from '../threads/threadStore';
import type { ThreadStateService } from './ThreadStateService';
import type { Thread, Message } from '../../shared/types';
import type { QueueSource } from './ThreadInputQueue';
import type { TurnEndReason } from './headlessRunner';
import { eventLogger } from '../utils/eventLog';

export type SetAutopilotOptions = {
  // When false, skip the post-enable afterTurnHook fire (caller is about to queue input;
  // the hook would race the queue and read pre-input state). Default true.
  triggerAfterTurn?: boolean;
};

export class AutopilotStateService {
  private kanbanWatchdog: ((taskId: string, projectId: string, reason: string) => void) | null = null;
  private afterTurnHook: ((threadId: string, source: QueueSource) => void) | null = null;
  // Last completed turn's end reason per thread. Used to mirror runTurn's timeout
  // skip when setAutopilot tries to kick the planner on re-enable.
  private lastTurnEndReason = new Map<string, TurnEndReason>();

  constructor(
    private readonly stateService: ThreadStateService,
    private readonly listMessages: (threadId: string) => Message[],
    private readonly getDecoratedThread: (threadId: string) => Thread | null
  ) {}

  setAfterTurnHook(fn: (threadId: string, source: QueueSource) => void): void {
    this.afterTurnHook = fn;
  }

  setKanbanWatchdog(cb: (taskId: string, projectId: string, reason: string) => void): void {
    this.kanbanWatchdog = cb;
  }

  setState(
    threadId: string,
    patch: {
      autopilotState: Thread['autopilotState'];
      autopilotLastReason?: string;
      autopilotConsecutiveTurns?: number;
    }
  ): void {
    const thread = threadStore.getThread(threadId);
    if (!thread) return;
    threadStore.updateThread(threadId, patch);
    this.broadcastAutopilotStatus(threadId, { ...thread, ...patch });

    // Watchdog: when a kanban-assigned thread's autopilot lands in `blocked`, notify the
    // kanban watchdog so it can record the failure on the task. `stopped` is the planner's
    // intentional halt (e.g. task already done) and must NOT trigger the watchdog.
    if (this.kanbanWatchdog && patch.autopilotState === 'blocked' && thread.taskId && thread.projectId) {
      this.kanbanWatchdog(thread.taskId, thread.projectId, patch.autopilotLastReason ?? 'Autopilot blocked');
    }
  }

  private broadcastAutopilotStatus(threadId: string, thread: Omit<Thread, 'logBuffer'>): void {
    this.stateService.broadcastAutopilotStatus(threadId, thread);
  }

  // Called from runTurn after a clean settle. Not called on the throw path — a thrown
  // turn leaves the previous reason in place, which is safe (over-conservative if the
  // previous reason was timeout) and self-heals on the next clean turn.
  recordTurnEndReason(threadId: string, reason: TurnEndReason | undefined): void {
    if (reason === undefined) {
      this.lastTurnEndReason.delete(threadId);
    } else {
      this.lastTurnEndReason.set(threadId, reason);
    }
  }

  setAutopilot(threadId: string, enabled: boolean, options?: SetAutopilotOptions): Thread {
    const thread = threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const patch = {
      autopilotEnabled: enabled,
      autopilotState: (enabled ? 'idle' : 'stopped') as Thread['autopilotState'],
      autopilotLastReason: enabled ? 'Autopilot enabled.' : 'Autopilot disabled.',
      autopilotConsecutiveTurns: 0,
    };
    threadStore.updateThread(threadId, patch);
    this.broadcastAutopilotStatus(threadId, { ...thread, ...patch });

    if (enabled && options?.triggerAfterTurn !== false) {
      const lastMsg = this.listMessages(threadId).at(-1);
      if (lastMsg?.role === 'assistant') {
        // Mirror runTurn's timeout guard: if the last completed turn was incomplete,
        // the assistant message we'd hand the planner is half-finished. Skip and wait for the
        // next clean turn.
        const lastReason = this.lastTurnEndReason.get(threadId);
        if (lastReason === 'timeout') {
          eventLogger.info('autopilot', 'Skipped: setAutopilot trigger after timeout turn', {
            threadId,
          });
        } else {
          if (!this.afterTurnHook) {
            eventLogger.warn('autopilot', 'afterTurnHook not set — autopilot trigger skipped', { threadId });
          }
          this.afterTurnHook?.(threadId, 'user');
        }
      }
    }
    return this.getDecoratedThread(threadId)!;
  }
}
