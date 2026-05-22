import { ipcMain, shell } from 'electron';
import { execSync } from 'child_process';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/types';
import { threadManager } from '../../sessions/ThreadManager';
import { isDockerAvailable, isImageBuilt, GLOBAL_IMAGE_NAME } from '../../utils/docker';
import { handleIpc } from '../ipcResponse';

const RemoveContainerSchema = z.object({
  containerName: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+$/)
    .max(128),
});

export function registerSandboxHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SANDBOX_CHECK_DOCKER, () =>
    handleIpc(async () => {
      const available = await isDockerAvailable();
      const imageBuilt = available ? await isImageBuilt(GLOBAL_IMAGE_NAME) : false;
      return { available, imageBuilt };
    })
  );

  ipcMain.handle(IPC_CHANNELS.SANDBOX_OPEN_DOCKER, async () => {
    if (process.platform === 'darwin') {
      try {
        execSync('open -a Docker', { stdio: 'ignore' });
      } catch {
        await shell.openExternal('https://www.docker.com/products/docker-desktop/');
      }
    } else {
      await shell.openExternal('https://www.docker.com/products/docker-desktop/');
    }
  });

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
