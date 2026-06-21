import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import type { CreateThreadRequest } from '../../../shared/types';
import { threadManager, threadLifecycle, threadReads, threadAutopilotState } from '../../sessions/ThreadManager';
import { threadId, filePath, shortName, ThreadIdSchema } from './schemas';
import { handleIpc } from '../ipcResponse';

const CreateThreadSchema = z.object({
  name: shortName,
  workingDirectory: filePath,
  provider: z.string().max(64).optional(),
  model: z.string().max(200).optional(),
  effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
  createWorktree: z.boolean().optional(),
  projectName: shortName.optional(),
  subdir: z.string().optional(),
});

const RenameThreadSchema = z.object({
  threadId,
  name: z.string().min(1).max(256),
});

export function registerThreadHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.THREAD_CREATE, (_e, raw) =>
    handleIpc(async () => {
      const req = CreateThreadSchema.parse(raw);
      return threadLifecycle.createThread(req as CreateThreadRequest);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_START, (_e, raw) =>
    handleIpc(async () => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      await threadLifecycle.startThread(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_STOP, (_e, raw) =>
    handleIpc(async () => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      await threadLifecycle.stopThread(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_DELETE, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadLifecycle.deleteThread(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_ARCHIVE, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadLifecycle.archiveThread(id);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_LIST, () => handleIpc(() => threadReads.getThreads()));

  ipcMain.handle(IPC_CHANNELS.THREAD_RENAME, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id, name } = RenameThreadSchema.parse(raw);
      return threadManager.renameThread(id, name);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_SET_AUTOPILOT, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id, enabled } = z.object({ threadId, enabled: z.boolean() }).parse(raw);
      return threadAutopilotState.setAutopilot(id, enabled);
    })
  );

  const SetProviderModelSchema = z.object({
    threadId,
    provider: z.string().min(1).max(64),
    model: z.string().max(200).optional(),
    effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
    reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
  });

  ipcMain.handle(IPC_CHANNELS.THREAD_SET_PROVIDER_MODEL, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id, provider, model, effort, reasoning } = SetProviderModelSchema.parse(raw);
      return threadManager.setThreadProviderModel(id, provider, model, effort, reasoning);
    })
  );

  ipcMain.handle(IPC_CHANNELS.THREAD_INJECTION_STATUS, (_e, raw) =>
    handleIpc(() => {
      const { threadId: id } = ThreadIdSchema.parse(raw);
      return threadReads.getInjectionStatus(id);
    })
  );
}
