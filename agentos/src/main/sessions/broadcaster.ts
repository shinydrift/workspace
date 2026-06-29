import { BrowserWindow, type WebContents } from 'electron';
import type {
  Thread,
  TerminalDataEvent,
  ThreadStatusEvent,
  ThreadRenamedEvent,
  MessageAppendedEvent,
  ThreadPostAppendedEvent,
  ThreadPostUpdatedEvent,
  AppSettings,
  PublicSettings,
  SavedProject,
} from '../../shared/types';
import { IPC_EVENTS } from '../../shared/types';
import { slackBridge } from '../integrations/slackBridge';
import { emitMessageAppended, emitThreadIdle } from '../events';
import { threadPostsStore } from './threadPostsStore';

let trayUpdateHook: (() => void) | null = null;

export function registerTrayUpdateHook(cb: () => void): void {
  trayUpdateHook = cb;
}

export function broadcastToWindows<T>(event: string, payload: T, exclude?: WebContents): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== exclude) {
      win.webContents.send(event, payload);
    }
  }
}

export function broadcastTerminalData(payload: TerminalDataEvent): void {
  broadcastToWindows(IPC_EVENTS.TERMINAL_DATA, payload);
}

export function broadcastStatus(payload: ThreadStatusEvent): void {
  slackBridge.onThreadStatus(payload);
  threadPostsStore.applyThreadStatus(payload);
  broadcastToWindows(IPC_EVENTS.THREAD_STATUS, payload);
  if (payload.status === 'idle') {
    emitThreadIdle({ threadId: payload.threadId });
  }
  trayUpdateHook?.();
}

export function broadcastRename(payload: ThreadRenamedEvent): void {
  broadcastToWindows(IPC_EVENTS.THREAD_RENAMED, payload);
  trayUpdateHook?.();
}

export function broadcastMessageAppended(payload: MessageAppendedEvent): void {
  slackBridge.onMessageAppended(payload);
  broadcastToWindows(IPC_EVENTS.MESSAGE_APPENDED, payload);
  emitMessageAppended(payload);
}

export function broadcastThreadPostAppended(payload: ThreadPostAppendedEvent): void {
  broadcastToWindows(IPC_EVENTS.THREAD_POST_APPENDED, payload);
}

export function broadcastThreadPostUpdated(payload: ThreadPostUpdatedEvent): void {
  broadcastToWindows(IPC_EVENTS.THREAD_POST_UPDATED, payload);
}

export function broadcastThreadCreated(thread: Thread): void {
  broadcastToWindows(IPC_EVENTS.THREAD_CREATED, thread);
  trayUpdateHook?.();
}

export function broadcastThreadDeleted(threadId: string): void {
  broadcastToWindows(IPC_EVENTS.THREAD_DELETED, { threadId });
  trayUpdateHook?.();
}

export function broadcastSettingsChanged(settings: AppSettings, exclude?: WebContents): void {
  // Strip credential fields — renderer doesn't need them and sending secrets
  // to all windows increases blast radius unnecessarily.
  const { apiKeys: _a, slack: _s, tailscale: _t, env, ...rest }: AppSettings = settings;
  // Keep env.safelist (non-secret, used to show inherited app safelist) but drop env.vars.
  const safe: PublicSettings = { ...rest, ...(env ? { env: { safelist: env.safelist } } : {}) };
  // Broadcast fires before the IPC response serialises back to the initiating
  // renderer, so pass exclude=sender to avoid a redundant self-update.
  broadcastToWindows<PublicSettings>(IPC_EVENTS.SETTINGS_CHANGED, safe, exclude);
}

export function broadcastProjectSaved(project: SavedProject, exclude?: WebContents): void {
  broadcastToWindows(IPC_EVENTS.PROJECT_SAVED, project, exclude);
}

export function broadcastProjectDeleted(projectId: string, exclude?: WebContents): void {
  broadcastToWindows(IPC_EVENTS.PROJECT_DELETED, { projectId }, exclude);
}

export function broadcastProjectConfigUpdated(projectPath: string, key: string, exclude?: WebContents): void {
  broadcastToWindows(IPC_EVENTS.PROJECT_CONFIG_UPDATED, { projectPath, key }, exclude);
}
