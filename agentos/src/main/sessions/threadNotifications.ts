import { app, Notification, type BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../shared/types/ipc';
import type { ThreadNotificationKind } from '../../shared/threadStatusLifecycle';
import type { ThreadUnreadEvent } from '../../shared/types';
import * as threadStore from '../threads/threadStore';
import { getStore } from '../store/index';
import { broadcastToWindows } from './broadcaster';

/**
 * In-app notifications for threads. Single owner of a thread's unread state: a notify-worthy event
 * (✅ done / ❌ error / attention) on a thread you're not looking at bumps a persisted unread tally
 * (survives restart), pushes the count to the renderer (list badge + toast), updates the dock/taskbar
 * badge, and — if the app is in the background and desktop notifications are enabled — raises an OS
 * notification. Viewing a thread (selecting it while the app is focused) clears it.
 *
 * Whether an event is notify-worthy is decided upstream by deriveStatusNotification / the clarification
 * post; this service only decides "should it be silent because you're already here" and how to render.
 */

// error outranks attention outranks done — the badge shows the most urgent pending reason.
const KIND_PRIORITY: Record<ThreadNotificationKind, number> = { error: 3, attention: 2, done: 1 };
const KIND_BODY: Record<ThreadNotificationKind, string> = {
  done: 'Turn finished',
  error: 'Turn failed',
  attention: 'Needs your input',
};

class ThreadNotificationService {
  private mainWindow: BrowserWindow | null = null;
  /** The thread the renderer currently has open — reported over thread:setActive. */
  private activeThreadId: string | null = null;

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    // Re-focusing the app catches up the thread that's already open on screen.
    mainWindow.on('focus', () => {
      if (this.activeThreadId) this.markRead(this.activeThreadId);
    });
    this.refreshBadge();
  }

  setActiveThread(threadId: string | null): void {
    this.activeThreadId = threadId;
    if (threadId && this.isFocused()) this.markRead(threadId);
  }

  /** Raise a notification for a notify-worthy event, unless you're already looking at the thread. */
  notify(threadId: string, kind: ThreadNotificationKind): void {
    if (this.isViewing(threadId)) return;
    const thread = threadStore.getThread(threadId);
    if (!thread) return;
    const unreadCount = (thread.unreadCount ?? 0) + 1;
    const unreadKind = this.mergeKind(thread.unreadKind, kind);
    threadStore.updateThread(threadId, { unreadCount, unreadKind });
    const event: ThreadUnreadEvent = { threadId, unreadCount, unreadKind, threadName: thread.name };
    broadcastToWindows(IPC_EVENTS.THREAD_UNREAD, event);
    this.refreshBadge();
    this.maybeNotifyDesktop(thread.name, kind, threadId);
  }

  markRead(threadId: string): void {
    const thread = threadStore.getThread(threadId);
    if (!thread || (thread.unreadCount ?? 0) === 0) return;
    threadStore.updateThread(threadId, { unreadCount: 0, unreadKind: null });
    const event: ThreadUnreadEvent = { threadId, unreadCount: 0, threadName: thread.name };
    broadcastToWindows(IPC_EVENTS.THREAD_UNREAD, event);
    this.refreshBadge();
  }

  private isFocused(): boolean {
    return !!this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isFocused();
  }

  private isViewing(threadId: string): boolean {
    return this.activeThreadId === threadId && this.isFocused();
  }

  private mergeKind(prev: ThreadNotificationKind | undefined, next: ThreadNotificationKind): ThreadNotificationKind {
    if (!prev) return next;
    return KIND_PRIORITY[next] >= KIND_PRIORITY[prev] ? next : prev;
  }

  private refreshBadge(): void {
    const total = threadStore.getAllThreads().reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);
    // No-op on Windows; sets the dock badge on macOS and the Unity launcher count on Linux.
    app.setBadgeCount(total);
  }

  private maybeNotifyDesktop(threadName: string, kind: ThreadNotificationKind, threadId: string): void {
    if (this.isFocused()) return; // app is up front — the toast + badge already surface it
    if (!getStore().get('settings').notifications?.desktop) return;
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: threadName, body: KIND_BODY[kind] });
    notification.on('click', () => {
      const win = this.mainWindow;
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(IPC_EVENTS.TRAY_NAVIGATE_TO_THREAD, { threadId });
    });
    notification.show();
  }
}

export const threadNotifications = new ThreadNotificationService();
