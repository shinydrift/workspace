import { app } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import { IPC_EVENTS } from '../../shared/types';
import type { UpdateReadyEvent } from '../../shared/types';
import { broadcastToWindows } from '../sessions/broadcaster';
import { eventLogger } from '../utils/eventLog';

// Held in main so the renderer can re-query after a reload — the updater's
// update-downloaded event fires only once per download.
let pendingUpdate: UpdateReadyEvent | null = null;

export function getPendingUpdate(): UpdateReadyEvent | null {
  return pendingUpdate;
}

// autoUpdater.quitAndInstall() bypasses 'before-quit' (no graceful shutdown) and
// its window-close step would be swallowed by the darwin hide-on-close handler.
// Instead, flag the install and go through the normal quit path — lifecycle.ts
// runs the shutdown drain, then installs (see setupLifecycle's before-quit).
let installRequested = false;

export function isUpdateInstallRequested(): boolean {
  return installRequested;
}

export function requestQuitAndInstall(): void {
  installRequested = true;
  app.quit();
}

export function setupAutoUpdates(): void {
  updateElectronApp({
    repo: 'godarapradeep/workspace',
    // Providing onNotifyUser suppresses the library's blocking restart dialog;
    // the renderer shows a title-bar badge instead (event:app:updateReady).
    onNotifyUser: (info) => {
      pendingUpdate = { releaseName: info.releaseName };
      eventLogger.info('app', 'update downloaded', { releaseName: info.releaseName });
      broadcastToWindows<UpdateReadyEvent>(IPC_EVENTS.UPDATE_READY, pendingUpdate);
    },
  });
}
