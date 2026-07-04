import { z } from 'zod';
import { IPC_CHANNELS, IPC_EVENTS } from '../../../shared/types';
import { councilService, councilEvents } from '../../council/service';
import { defineHandler } from '../ipcResponse';
import { broadcastToWindows } from '../../sessions/broadcaster';
import { threadManager } from '../../sessions/ThreadManager';

const providerEnum = z.enum(['claude', 'claude-interactive', 'codex', 'gemini']);
const memberSchema = z.object({
  provider: providerEnum,
  model: z.string().min(1).max(128),
  effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
});

export function registerCouncilHandlers(): void {
  // Forward service events out to renderer windows
  councilEvents.on('run:updated', (run) => {
    broadcastToWindows(IPC_EVENTS.COUNCIL_RUN_UPDATED, run);
    // Re-project the parent's status so the 🏛️ indicator appears on dispatch and resolves on
    // completion, instead of waiting for the next turn event.
    threadManager.rebroadcastStatus(run.parentThreadId);
    if (run.status === 'done') {
      threadManager.triggerAutopilotForCouncilDone(run.parentThreadId, run.id);
    }
  });
  councilEvents.on('outcome:submitted', (payload) => {
    broadcastToWindows(IPC_EVENTS.COUNCIL_OUTCOME_SUBMITTED, payload);
  });

  defineHandler(IPC_CHANNELS.COUNCIL_LIST_CONFIGS, z.undefined(), () => councilService.listConfigs());

  defineHandler(IPC_CHANNELS.COUNCIL_GET_CONFIG, z.object({ id: z.string().min(1) }), ({ id }) =>
    councilService.getConfig(id)
  );

  defineHandler(
    IPC_CHANNELS.COUNCIL_UPSERT_CONFIG,
    z.object({
      id: z.string().min(1).optional(),
      name: z.string().min(1).max(128),
      members: z.array(memberSchema).min(1).max(8),
    }),
    (req) => councilService.upsertConfig(req)
  );

  defineHandler(IPC_CHANNELS.COUNCIL_DELETE_CONFIG, z.object({ id: z.string().min(1) }), ({ id }) => {
    councilService.deleteConfig(id);
  });

  defineHandler(
    IPC_CHANNELS.COUNCIL_RUN,
    z.object({
      configId: z.string().min(1),
      parentThreadId: z.string().min(1),
      prompt: z.string().min(1).max(50_000),
    }),
    async (req) => {
      const run = await councilService.runCouncil(req);
      return run;
    }
  );

  defineHandler(IPC_CHANNELS.COUNCIL_GET_RUN, z.object({ runId: z.string().min(1) }), ({ runId }) =>
    councilService.getRun(runId)
  );

  defineHandler(IPC_CHANNELS.COUNCIL_GET_OUTCOMES, z.object({ runId: z.string().min(1) }), ({ runId }) =>
    councilService.getOutcomes(runId)
  );

  defineHandler(
    IPC_CHANNELS.COUNCIL_LIST_RUNS_BY_THREAD,
    z.object({ parentThreadId: z.string().min(1) }),
    ({ parentThreadId }) => councilService.getRunsByThread(parentThreadId)
  );
}
