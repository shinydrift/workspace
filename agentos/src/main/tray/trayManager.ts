import { BrowserWindow, Tray, app, ipcMain, nativeImage, screen } from 'electron';
import type { IpcMainEvent, Rectangle } from 'electron';
import { internalBus } from '../events';
import type { TurnActiveEvent, ThreadIdleEvent } from '../events';
import { IPC_EVENTS, TRAY_CHANNELS } from '../../shared/types/ipc';
import type { Thread, TrayThread, MessageAppendedEvent } from '../../shared/types';
import { makeBlockGridPng, makeAnimFramePng } from '../utils/pngGenerator';

// ── Helpers (exported for tests) ─────────────────────────────────────────────

type IconState = 'idle' | 'running' | 'building';

function isActiveThread(t: Thread): boolean {
  return t.status !== 'archived' && t.status !== 'stopped';
}

// Animation runs while:
//   • a turn is in flight (between turn:started and turn:ended), or
//   • a thread is provisioning ('building'), or
//   • a thread is in its startup window — PTY is alive ('running') but the
//     agent hasn't completed its first turn yet (boot/memory injection).
// The DB 'running' status persists for the lifetime of the PTY, so on its own
// it isn't a turn-in-progress signal. The startup window is bounded by the
// first 'thread:idle' broadcast (i.e. the first turn end).
export function deriveIconState(
  threads: Thread[],
  turnsInProgress: ReadonlySet<string>,
  threadsPostFirstTurn: ReadonlySet<string>
): IconState {
  const active = threads.filter(isActiveThread);
  const inFlight = (t: Thread) =>
    turnsInProgress.has(t.id) || (t.status === 'running' && !threadsPostFirstTurn.has(t.id));
  if (active.some(inFlight)) return 'running';
  if (active.some((t) => t.status === 'building')) return 'building';
  return 'idle';
}

export function buildTrayThreads(
  threads: Thread[],
  resolveProjectName: (projectId: string) => string,
  lastMessages: Map<string, string>
): TrayThread[] {
  return threads
    .filter((t) => isActiveThread(t) && !t.parentThreadId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((t) => ({
      id: t.id,
      name: t.name,
      projectName: resolveProjectName(t.projectId),
      status: t.status,
      autopilotEnabled: t.autopilotEnabled ?? false,
      autopilotState: t.autopilotState,
      lastActiveAt: t.lastActiveAt,
      lastMessage: lastMessages.get(t.id) ?? '',
    }));
}

// Clamp popover rect to display work area so it doesn't render off-screen on
// secondary displays, near taskbars, or when tray bounds are degenerate.
export function computePopoverPosition(
  trayBounds: Rectangle | undefined,
  workArea: Rectangle,
  popoverSize: { width: number; height: number },
  fallback: { x: number; y: number }
): { x: number; y: number } {
  const hasTray = trayBounds && (trayBounds.width > 0 || trayBounds.height > 0);
  const anchorX = hasTray ? trayBounds.x + trayBounds.width / 2 - popoverSize.width / 2 : fallback.x;
  const anchorY = hasTray ? trayBounds.y + trayBounds.height + POPOVER_GAP : fallback.y;
  const maxX = workArea.x + workArea.width - popoverSize.width;
  const maxY = workArea.y + workArea.height - popoverSize.height;
  return {
    x: Math.round(Math.min(Math.max(anchorX, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(anchorY, workArea.y), maxY)),
  };
}

// ── TrayManager ──────────────────────────────────────────────────────────────

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 480;
const POPOVER_GAP = 4;
const ANIMATED_STATES: ReadonlySet<IconState> = new Set(['running', 'building']);

export class TrayManager {
  private tray: Tray | null = null;
  private popover: BrowserWindow | null = null;
  private lastMessages = new Map<string, string>();
  private _initialized = false;
  private animInterval: ReturnType<typeof setInterval> | null = null;
  private animFrame = 0;
  private currentIconState: IconState = 'idle';
  private turnsInProgress = new Set<string>();
  private threadsPostFirstTurn = new Set<string>();
  private updatePending = false;

  private readonly focusThreadHandler = (_e: IpcMainEvent, { threadId }: { threadId: string }) => {
    this.closePopover();
    if (!this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
      this.mainWindow.webContents.send(IPC_EVENTS.TRAY_NAVIGATE_TO_THREAD, { threadId });
    }
  };

  private readonly openAppHandler = () => {
    this.closePopover();
    if (!this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  };

  private readonly quitAppHandler = () => {
    app.quit();
  };

  private readonly messageAppendedHandler = (payload: MessageAppendedEvent) => {
    if (payload.message.role === 'assistant') {
      const text = (payload.message.content ?? '').split('\n')[0].slice(0, 120);
      this.lastMessages.set(payload.threadId, text);
      this.scheduleUpdate();
    }
  };

  private readonly turnStartedHandler = (payload: TurnActiveEvent) => {
    this.turnsInProgress.add(payload.threadId);
    this.scheduleUpdate();
  };

  private readonly turnEndedHandler = (payload: TurnActiveEvent) => {
    if (this.turnsInProgress.delete(payload.threadId)) this.scheduleUpdate();
  };

  // The first 'thread:idle' broadcast marks the end of a thread's startup
  // window (boot/memory injection finished). After that, plain 'running' DB
  // status no longer animates the tray — only an in-flight turn does.
  private readonly threadIdleHandler = (payload: ThreadIdleEvent) => {
    if (!this.threadsPostFirstTurn.has(payload.threadId)) {
      this.threadsPostFirstTurn.add(payload.threadId);
      this.scheduleUpdate();
    }
  };

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly resolveProjectName: (projectId: string) => string,
    private readonly getThreads: () => Thread[],
    private readonly loadPopover: (win: BrowserWindow) => void,
    private readonly preloadPath: string
  ) {}

  init(): void {
    if (this._initialized) return;
    this._initialized = true;

    const icon = nativeImage.createFromBuffer(makeBlockGridPng());
    icon.setTemplateImage(true);

    this.tray = new Tray(icon);
    this.tray.setToolTip('AgentOS');
    this.tray.on('click', () => this.togglePopover());

    internalBus.on('message:appended', this.messageAppendedHandler);
    internalBus.on('turn:started', this.turnStartedHandler);
    internalBus.on('turn:ended', this.turnEndedHandler);
    internalBus.on('thread:idle', this.threadIdleHandler);
    ipcMain.on(TRAY_CHANNELS.FOCUS_THREAD, this.focusThreadHandler);
    ipcMain.on(TRAY_CHANNELS.OPEN_APP, this.openAppHandler);
    ipcMain.on(TRAY_CHANNELS.QUIT_APP, this.quitAppHandler);
  }

  update(): void {
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.updatePending) return;
    this.updatePending = true;
    queueMicrotask(() => {
      this.updatePending = false;
      this.applyUpdate();
    });
  }

  private applyUpdate(): void {
    if (!this._initialized) return;
    const threads = this.getThreads();
    this.pruneLastMessages(threads);
    this.pruneTurnsInProgress(threads);

    const newState = deriveIconState(threads, this.turnsInProgress, this.threadsPostFirstTurn);

    if (newState !== this.currentIconState) {
      this.currentIconState = newState;
      if (ANIMATED_STATES.has(newState)) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    }
    this.pushToPopover();
  }

  private pruneLastMessages(threads: Thread[]): void {
    if (this.lastMessages.size === 0) return;
    const live = new Set(threads.filter(isActiveThread).map((t) => t.id));
    for (const id of this.lastMessages.keys()) {
      if (!live.has(id)) this.lastMessages.delete(id);
    }
  }

  // Drop per-thread state for threads that no longer exist or have been
  // stopped/archived. Guards against leaks if turn:ended was skipped (e.g. a
  // crash) and ensures a restarted thread re-enters its startup window.
  private pruneTurnsInProgress(threads: Thread[]): void {
    if (this.turnsInProgress.size === 0 && this.threadsPostFirstTurn.size === 0) return;
    const live = new Set(threads.filter(isActiveThread).map((t) => t.id));
    for (const id of this.turnsInProgress) {
      if (!live.has(id)) this.turnsInProgress.delete(id);
    }
    for (const id of this.threadsPostFirstTurn) {
      if (!live.has(id)) this.threadsPostFirstTurn.delete(id);
    }
  }

  private static readonly ANIM_FRAMES = 16;
  private static readonly ANIM_INTERVAL = 100; // 16 frames × 100ms = 1.6s period (matches splash)

  private startAnimation(): void {
    if (this.animInterval) return;
    this.animFrame = 0;
    this.animInterval = setInterval(() => {
      if (!this.tray) return;
      this.animFrame = (this.animFrame + 1) % TrayManager.ANIM_FRAMES;
      const frame = nativeImage.createFromBuffer(makeAnimFramePng(this.animFrame, TrayManager.ANIM_FRAMES));
      frame.setTemplateImage(true);
      this.tray.setImage(frame);
    }, TrayManager.ANIM_INTERVAL);
  }

  private stopAnimation(): void {
    if (!this.animInterval) return;
    clearInterval(this.animInterval);
    this.animInterval = null;
    if (this.tray) {
      const icon = nativeImage.createFromBuffer(makeBlockGridPng());
      icon.setTemplateImage(true);
      this.tray.setImage(icon);
    }
  }

  destroy(): void {
    this._initialized = false;
    this.turnsInProgress.clear();
    this.threadsPostFirstTurn.clear();
    this.currentIconState = 'idle';
    this.stopAnimation();
    internalBus.off('message:appended', this.messageAppendedHandler);
    internalBus.off('turn:started', this.turnStartedHandler);
    internalBus.off('turn:ended', this.turnEndedHandler);
    internalBus.off('thread:idle', this.threadIdleHandler);
    ipcMain.off(TRAY_CHANNELS.FOCUS_THREAD, this.focusThreadHandler);
    ipcMain.off(TRAY_CHANNELS.OPEN_APP, this.openAppHandler);
    ipcMain.off(TRAY_CHANNELS.QUIT_APP, this.quitAppHandler);
    this.closePopover();
    this.tray?.destroy();
    this.tray = null;
  }

  // Satisfies the Disposable interface used by the bootstrap disposables list.
  dispose(): void {
    this.destroy();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private togglePopover(): void {
    if (!this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }
    if (this.popover && !this.popover.isDestroyed()) {
      this.closePopover();
    } else {
      this.openPopover();
    }
  }

  private openPopover(): void {
    const trayBounds = this.tray?.getBounds();

    this.popover = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.preloadPath,
      },
    });

    this.loadPopover(this.popover);

    this.popover.once('ready-to-show', () => {
      if (!this.popover || this.popover.isDestroyed()) return;
      const display = trayBounds
        ? screen.getDisplayMatching(trayBounds)
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const cursor = screen.getCursorScreenPoint();
      const { x, y } = computePopoverPosition(
        trayBounds,
        display.workArea,
        { width: POPOVER_WIDTH, height: POPOVER_HEIGHT },
        { x: cursor.x - POPOVER_WIDTH / 2, y: cursor.y }
      );
      this.popover.setPosition(x, y);
      this.popover.show();
      this.pushToPopover();
    });

    this.popover.on('blur', () => this.closePopover());
    this.popover.on('closed', () => {
      this.popover = null;
    });
  }

  private closePopover(): void {
    if (this.popover && !this.popover.isDestroyed()) {
      this.popover.close();
    }
    this.popover = null;
  }

  private pushToPopover(): void {
    if (!this.popover || this.popover.isDestroyed()) return;
    const threads = this.getThreads();
    const trayThreads = buildTrayThreads(threads, this.resolveProjectName, this.lastMessages);
    this.popover.webContents.send(IPC_EVENTS.TRAY_THREADS_UPDATE, trayThreads);
  }
}
