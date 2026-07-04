import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import { threadManager } from '../../sessions/ThreadManager';
import { handleIpc } from '../ipcResponse';

const RemoveContainerSchema = z.object({
  containerName: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+$/)
    .max(128),
});

export function registerSandboxHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SANDBOX_LIST_CONTAINERS, () => handleIpc(() => threadManager.listContainerSummaries()));

  ipcMain.handle(IPC_CHANNELS.SANDBOX_PRUNE_CONTAINERS, () =>
    handleIpc(() => threadManager.pruneContainers({ force: true }))
  );

  ipcMain.handle(IPC_CHANNELS.SANDBOX_REMOVE_CONTAINER, (_e, raw) =>
    handleIpc(async () => {
      const { containerName } = RemoveContainerSchema.parse(raw);
      await threadManager.removeContainer(containerName);
    })
  );
}
