import { app, BrowserWindow } from 'electron';
import { createWindow } from './windows';
import { IPC_EVENTS } from '../../shared/types/ipc';
import type { ShutdownOverlayPayload } from '../../shared/types/ipc';
import { eventLogger } from '../utils/eventLog';
import type { Services } from './services';
import type { Disposable } from '../lifecycle';

const SHUTDOWN_TIMEOUT_MS = 60_000;

export async function runGracefulShutdown(
  disposables: Disposable[],
  timeoutMs = SHUTDOWN_TIMEOUT_MS
): Promise<'completed' | 'timed-out'> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // The shutdown task is not cancellable — if the timeout wins, in-flight
  // disposals keep running until app.exit(0) terminates the process.
  const shutdownTask = (async (): Promise<'completed'> => {
    // Disposals run in reverse registration order; isolate each so one failure
    // cannot skip the rest.
    for (const d of [...disposables].reverse()) {
      try {
        await d.dispose();
      } catch (err) {
        eventLogger.warn('shutdown', 'Disposal step failed — continuing', {
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
      }
    }
    return 'completed';
  })();

  const timeoutTask = new Promise<'timed-out'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timed-out'), timeoutMs);
  });

  const result = await Promise.race([shutdownTask, timeoutTask]);
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  return result;
}

function sendShutdownStep(overlay: BrowserWindow, step: string, done = false): void {
  if (overlay.isDestroyed()) return;
  const payload: ShutdownOverlayPayload = { step, done };
  const send = () => {
    if (!overlay.isDestroyed()) overlay.webContents.send(IPC_EVENTS.SHUTDOWN_OVERLAY_STATE, payload);
  };
  // Guard against early-quit: if the renderer hasn't loaded yet, defer until it has.
  if (overlay.webContents.isLoading()) {
    overlay.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

export function setupLifecycle(services: Services, preloadPath: string, rendererBase: string): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(preloadPath, rendererBase);
    } else if (!services.mainWindow.isDestroyed() && !services.mainWindow.isVisible()) {
      services.mainWindow.show();
      services.mainWindow.focus();
    }
  });

  // macOS: hide main window on close so it can be restored via the tray
  if (process.platform === 'darwin') {
    services.mainWindow.on('close', (e) => {
      if (!services.mainWindow.isDestroyed()) {
        e.preventDefault();
        services.mainWindow.hide();
      }
    });
  }

  app.on('before-quit', (e) => {
    e.preventDefault();
    void (async () => {
      // Hide main window immediately so the app feels responsive
      if (!services.mainWindow.isDestroyed()) services.mainWindow.hide();

      // Show shutdown overlay with progress
      if (!services.shutdownOverlay.isDestroyed()) services.shutdownOverlay.show();
      sendShutdownStep(services.shutdownOverlay, 'Saving data\u2026');

      const result = await runGracefulShutdown(services.disposables);

      if (result === 'timed-out') {
        eventLogger.warn('shutdown', 'Graceful shutdown timed out — forcing exit');
      }

      sendShutdownStep(services.shutdownOverlay, 'Done', true);
      // Brief pause so the user sees the done state before the window closes.
      // This 400 ms is intentionally outside the 15 s timeout — it only runs
      // after all cleanup (or the timeout) has resolved.
      await new Promise<void>((resolve) => setTimeout(resolve, 400));

      app.exit(0);
    })();
  });
}
