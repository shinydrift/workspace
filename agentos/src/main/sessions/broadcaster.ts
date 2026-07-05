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
import { deriveThreadDisplayStatus, deriveStatusNotification } from '../../shared/threadStatusLifecycle';
import { councilService } from '../council/service';
import * as threadStore from '../threads/threadStore';
import { threadNotifications } from './threadNotifications';

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
  // Derive the lifecycle indicator (👀/🤖/🏛️/✅/❌) once here — renderer badge and Slack reaction
  // render it as-is — and persist it on the thread so it survives an app restart.
  const councilPending = councilService.hasPendingRunForThread(payload.threadId);
  const event: ThreadStatusEvent = { ...payload, reaction: deriveThreadDisplayStatus(payload, councilPending) };
  const existing = threadStore.getThread(event.threadId);
  if (existing) {
    // Compare against the previously-persisted reaction before overwriting it — the notification
    // fires once on the settling edge (working → done/error/attention), not on repeated broadcasts.
    const notification = deriveStatusNotification(existing.currentReaction, payload, event.reaction ?? null);
    threadStore.updateThread(event.threadId, { currentReaction: event.reaction });
    // Council sub-threads collapse under their parent, so a finished member isn't independently
    // actionable — don't raise a notification for it.
    if (notification && !existing.parentThreadId) threadNotifications.notify(event.threadId, notification);
  }
  slackBridge.onThreadStatus(event);
  threadPostsStore.applyThreadStatus(event);
  broadcastToWindows(IPC_EVENTS.THREAD_STATUS, event);
  if (event.status === 'idle') {
    emitThreadIdle({ threadId: event.threadId });
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
  // A clarification request is a needs-attention signal — done/error come through broadcastStatus.
  if (payload.post.kind === 'clarification') threadNotifications.notify(payload.threadId, 'attention');
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
