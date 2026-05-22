import * as threadStore from '../threads/threadStore';
import type { ThreadStateService } from './ThreadStateService';
import type { Thread, Message } from '../../shared/types';
import type { QueueSource } from './ThreadInputQueue';
import { eventLogger } from '../utils/eventLog';

export class AutopilotStateService {
  private kanbanWatchdog: ((taskId: string, projectId: string, reason: string) => void) | null = null;
  private afterTurnHook: ((threadId: string, source: QueueSource) => void) | null = null;

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

    // Watchdog: if a kanban-assigned thread's autopilot fails (blocked), move its task back
    // to refining so a human / next run can retake it. `stopped` is the planner's intentional
    // halt (e.g. task already done) and must NOT revert the task.
    if (this.kanbanWatchdog && patch.autopilotState === 'blocked' && thread.taskId && thread.projectId) {
      this.kanbanWatchdog(thread.taskId, thread.projectId, patch.autopilotLastReason ?? 'Autopilot blocked');
    }
  }

  private broadcastAutopilotStatus(threadId: string, thread: Omit<Thread, 'logBuffer'>): void {
    this.stateService.broadcastAutopilotStatus(threadId, thread);
  }

  setAutopilot(threadId: string, enabled: boolean): Thread {
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

    if (enabled) {
      const lastMsg = this.listMessages(threadId).at(-1);
      if (lastMsg?.role === 'assistant') {
        if (!this.afterTurnHook) {
          eventLogger.warn('autopilot', 'afterTurnHook not set — autopilot trigger skipped', { threadId });
        }
        this.afterTurnHook?.(threadId, 'user');
      }
    }
    return this.getDecoratedThread(threadId)!;
  }
}
