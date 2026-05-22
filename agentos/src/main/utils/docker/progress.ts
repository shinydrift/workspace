import { BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../../shared/types';

export function broadcastProgress(message: string): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.SANDBOX_IMAGE_BUILDING, { progress: message });
    }
  }
}

export function broadcastImageUpdated(payload: { imageName: string; projectId?: string }): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.SANDBOX_IMAGE_UPDATED, payload);
    }
  }
}
