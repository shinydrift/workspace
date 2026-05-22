import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_EVENTS } from '../../shared/types/ipc';
import { FEATURES } from '../../shared/features';
import type { Services } from './services';

const RecordingOverlaySchema = z.object({
  state: z.enum(['idle', 'recording', 'transcribing']),
  downloadProgress: z.number().nullable(),
  transcriptPreview: z.string().max(500),
});

export function registerAppIpcHandlers(services: Services): void {
  if (!FEATURES.VOICE_FLOW) return;

  const { mainWindow, recordingOverlay } = services;
  let lastOverlayState: z.infer<typeof RecordingOverlaySchema>['state'] = 'idle';

  ipcMain.on(IPC_EVENTS.RECORDING_OVERLAY_STATE, (_e, raw) => {
    const result = RecordingOverlaySchema.safeParse(raw);
    if (!result.success) return;
    const payload = result.data;
    lastOverlayState = payload.state;
    if (!recordingOverlay || recordingOverlay.isDestroyed()) return;
    recordingOverlay.webContents.send(IPC_EVENTS.RECORDING_OVERLAY_STATE, payload);
    if (payload.state !== 'idle') {
      const appFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
      if (!appFocused && !recordingOverlay.isVisible()) recordingOverlay.showInactive();
      if (appFocused && recordingOverlay.isVisible()) recordingOverlay.hide();
    } else {
      if (recordingOverlay.isVisible()) recordingOverlay.hide();
    }
  });

  mainWindow.on('focus', () => {
    if (recordingOverlay && !recordingOverlay.isDestroyed() && recordingOverlay.isVisible()) {
      recordingOverlay.hide();
    }
  });

  mainWindow.on('blur', () => {
    if (recordingOverlay && !recordingOverlay.isDestroyed() && lastOverlayState !== 'idle') {
      if (!recordingOverlay.isVisible()) recordingOverlay.showInactive();
    }
  });

  ipcMain.on(IPC_EVENTS.RECORDING_CANCEL, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENTS.RECORDING_CANCEL);
    }
  });
}
