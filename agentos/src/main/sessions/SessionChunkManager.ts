import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type { Message } from '../../shared/types';
import type { QueueSource } from './ThreadInputQueue';

export class SessionChunkManager {
  private readonly _pending = new Set<string>();
  private readonly _stopResolvers = new Map<string, () => void>();
  private readonly _stopAborted = new Set<string>();

  constructor(
    private readonly hasPty: (threadId: string) => boolean,
    private readonly listMessages: (threadId: string) => Message[],
    private readonly sendInput: (threadId: string, input: string, source: QueueSource) => Promise<void>
  ) {}

  clearPending(threadId: string): void {
    this._pending.delete(threadId);
    // If new non-skills input arrived during a pre-stop save, mark the stop as
    // aborted synchronously before resolving — the queue may not be populated yet
    // when the saveBeforeStop promise resumes.
    const resolver = this._stopResolvers.get(threadId);
    if (resolver) {
      this._stopResolvers.delete(threadId);
      this._stopAborted.add(threadId);
      resolver();
    }
  }

  consumeStopAborted(threadId: string): boolean {
    const aborted = this._stopAborted.has(threadId);
    this._stopAborted.delete(threadId);
    return aborted;
  }

  // Called by ThreadManager on thread:idle — resolves any pending saveBeforeStop promise.
  handleThreadIdle(threadId: string): void {
    const resolver = this._stopResolvers.get(threadId);
    if (!resolver) return;
    eventLogger.info('memory', 'Thread idle after pre-stop save, resolving stop', { threadId });
    this._stopResolvers.delete(threadId);
    this._pending.delete(threadId);
    resolver();
  }

  // Injects /save-session-chunk and returns a promise that resolves when the skill
  // finishes (thread goes idle again) or times out. Called before stopping a container.
  saveBeforeStop(threadId: string, timeoutMs = 30_000): Promise<void> {
    if (!this.hasPty(threadId)) return Promise.resolve();
    const hasAssistantMessage = this.listMessages(threadId).some((m) => m.role === 'assistant');
    if (!hasAssistantMessage) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(threadId);
        this._stopResolvers.delete(threadId);
        eventLogger.warn('memory', 'Pre-stop save timed out', { threadId });
        resolve();
      }, timeoutMs);

      this._stopResolvers.set(threadId, () => {
        clearTimeout(timer);
        resolve();
      });

      if (!this._pending.has(threadId)) {
        this._pending.add(threadId);
        eventLogger.info('memory', 'Injecting /save-session-chunk before stop', { threadId });
        this.sendInput(threadId, '/save-session-chunk\n', 'skills').catch((err: unknown) => {
          clearTimeout(timer);
          this._pending.delete(threadId);
          this._stopResolvers.delete(threadId);
          eventLogger.warn('memory', 'Failed to inject /save-session-chunk before stop', {
            threadId,
            error: getErrorMessage(err),
          });
          resolve();
        });
      }
      // If already pending (skill injected elsewhere), just wait for the resolver.
    });
  }
}
