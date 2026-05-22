import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import type { QueueSource } from './ThreadInputQueue';

export class CouncilSynthesisManager {
  private readonly triggered = new Set<string>();

  constructor(
    private readonly dropAutopilotItems: (threadId: string) => void,
    private readonly hasPty: (threadId: string) => boolean,
    private readonly startThread: (threadId: string) => Promise<void>,
    private readonly sendInput: (threadId: string, input: string, source: QueueSource) => Promise<void>
  ) {}

  maybeTriggerSynthesis(threadId: string, runId: string): void {
    if (this.triggered.has(runId)) return;
    this.dropAutopilotItems(threadId);
    const message = `Council run ${runId} complete. Review member responses and synthesize.`;
    const enqueue = async () => {
      if (!this.hasPty(threadId)) {
        await this.startThread(threadId);
      }
      await this.sendInput(threadId, `${message}\n`, 'automation');
      this.triggered.add(runId);
    };
    enqueue().catch((error: unknown) => {
      eventLogger.error('council', 'Failed to enqueue council synthesis', {
        threadId,
        runId,
        error: getErrorMessage(error),
      });
    });
  }
}
