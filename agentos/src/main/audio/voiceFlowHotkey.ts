import { exec } from 'child_process';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
import { app, ipcMain, systemPreferences, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../shared/types';
import { settingsEvents, getStore } from '../store/index';
import type { AppSettings } from '../../shared/types/settings';
import { eventLogger } from '../utils/eventLog';

const LOG = 'voice-flow';

const DEFAULT_KEY = 'Alt';
/** Hold duration before recording starts — short enough to feel snappy, long enough to ignore stray taps. */
const COUNTDOWN_MS = 1000;
/**
 * Safety net: if the global hook ever misses a key-up (focus/Spaces switch, secure input, etc.), the held
 * key would otherwise stay "active" forever and wedge the hotkey. Force-release after this long. Must exceed
 * any legitimate hold — recording hard-caps at 120s (MAX_RECORD_SECONDS) so 150s never fires mid-use.
 */
const STUCK_KEY_TIMEOUT_MS = 150_000;

/** For modifier keys, both left and right variants should match (e.g. either ⌘ key). */
const MODIFIER_PAIRS: Record<string, readonly (keyof typeof UiohookKey)[]> = {
  Meta: ['Meta', 'MetaRight'],
  Shift: ['Shift', 'ShiftRight'],
  ShiftLeft: ['Shift'],
  Ctrl: ['Ctrl', 'CtrlRight'],
  Alt: ['Alt', 'AltRight'],
};

export function resolveKeyCodes(keyName: string): Set<number> {
  const names = MODIFIER_PAIRS[keyName] ?? [keyName as keyof typeof UiohookKey];
  const codes = new Set<number>();
  for (const n of names) {
    const c = UiohookKey[n];
    if (typeof c === 'number') codes.add(c);
  }
  if (codes.size === 0) {
    const fallbackNames = MODIFIER_PAIRS[DEFAULT_KEY] ?? [DEFAULT_KEY as keyof typeof UiohookKey];
    for (const n of fallbackNames) {
      const c = UiohookKey[n];
      if (typeof c === 'number') codes.add(c);
    }
  }
  return codes;
}

/** AXRoles that count as editable text inputs for paste routing. AXWebArea excluded — it matches all web pages, not just editable ones. */
const TEXT_FIELD_ROLES = new Set(['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField']);

interface FrontmostAppInfo {
  /** Process name as reported by System Events, or null on error. */
  name: string | null;
  /** Whether the frontmost app's focused element is an editable text field. */
  isTextField: boolean;
}

/**
 * Single osascript that returns both the frontmost app's process name and whether
 * its focused UI element is a text field.
 * macOS only; resolves { name: null, isTextField: false } on other platforms or error.
 */
function checkFrontmostApp(): Promise<FrontmostAppInfo> {
  if (process.platform !== 'darwin') return Promise.resolve({ name: null, isTextField: false });
  return new Promise((resolve) => {
    exec(
      `osascript -e 'tell application "System Events"
  set p to first process whose frontmost is true
  set n to name of p
  set r to ""
  try
    set r to value of attribute "AXRole" of (value of attribute "AXFocusedUIElement" of p)
  end try
  return n & (ASCII character 31) & r
end tell'`,
      { timeout: 1500, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        if (err) {
          // Almost always a missing "Automation → System Events" grant (or timeout). Log the
          // details so a null frontmostApp (which silently routes to a new thread) is diagnosable.
          eventLogger.warn(LOG, 'checkFrontmostApp osascript failed', {
            message: err.message,
            stderr: (stderr || '').trim(),
          });
          resolve({ name: null, isTextField: false });
          return;
        }
        // ASCII 31 (Unit Separator) is used as delimiter — safe against any printable app name.
        const sep = stdout.indexOf('\x1f');
        const name = sep > 0 ? stdout.slice(0, sep) : null;
        const role = sep >= 0 ? stdout.slice(sep + 1).trim() : '';
        eventLogger.info(LOG, 'checkFrontmostApp resolved', {
          name,
          role,
          isTextField: TEXT_FIELD_ROLES.has(role),
        });
        resolve({ name, isTextField: TEXT_FIELD_ROLES.has(role) });
      }
    );
  });
}

export class VoiceFlowHotkey {
  private configuredKeyCodes: Set<number> = resolveKeyCodes(DEFAULT_KEY);
  private escKeycodes: Set<number> = resolveKeyCodes('Escape');
  private isRecording = false;
  private started = false;
  private getMainWindow: (() => BrowserWindow | null) | null = null;
  private settingsChangeHandler: ((s: AppSettings) => void) | null = null;
  /** Keycode that started the current recording; prevents double-trigger on key-repeat. Cleared only by the physical key-up. */
  private activeKeycode: number | null = null;
  /** Countdown timer before recording starts; cancel clears this. */
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  /** Self-heal timer that force-releases activeKeycode if the matching key-up is ever dropped by the global hook. */
  private stuckKeyTimer: ReturnType<typeof setTimeout> | null = null;
  /** True from VOICE_FLOW_START send until the renderer acks VOICE_FLOW_STOPPED — gates Esc cancel. */
  private voiceFlowActive = false;

  /** Clear the held-key marker and its self-heal watchdog together. */
  private clearActiveKey(): void {
    this.activeKeycode = null;
    if (this.stuckKeyTimer !== null) {
      clearTimeout(this.stuckKeyTimer);
      this.stuckKeyTimer = null;
    }
  }

  /** (Re)arm the watchdog that recovers from a dropped key-up so the hotkey can never wedge. */
  private armStuckKeyWatchdog(): void {
    if (this.stuckKeyTimer !== null) clearTimeout(this.stuckKeyTimer);
    this.stuckKeyTimer = setTimeout(() => {
      this.stuckKeyTimer = null;
      if (this.activeKeycode === null) return;
      eventLogger.warn(LOG, 'Key-up missed; force-releasing stuck hotkey', { keycode: this.activeKeycode });
      const wasRecording = this.isRecording;
      const w = this.getMainWindow?.();
      if (this.startTimer !== null) {
        clearTimeout(this.startTimer);
        this.startTimer = null;
      }
      this.clearActiveKey();
      this.isRecording = false;
      if (wasRecording && w && !w.isDestroyed()) w.webContents.send(IPC_EVENTS.VOICE_FLOW_STOP);
    }, STUCK_KEY_TIMEOUT_MS);
  }

  private onProcessExit = (): void => {
    if (this.started) {
      try {
        uIOhook.stop();
      } catch {
        // best-effort
      }
      this.started = false;
    }
  };

  private onKeyDown = (e: UiohookKeyboardEvent): void => {
    const w = this.getMainWindow?.();
    if (this.escKeycodes.has(e.keycode)) {
      if (!this.voiceFlowActive) return;
      // Abort any pending countdown and recording, then ask the renderer to cancel.
      if (this.startTimer !== null) {
        clearTimeout(this.startTimer);
        this.startTimer = null;
      }
      this.isRecording = false;
      this.voiceFlowActive = false;
      eventLogger.info(LOG, 'Esc pressed, cancelling voice flow');
      if (w && !w.isDestroyed()) w.webContents.send(IPC_EVENTS.RECORDING_CANCEL);
      return;
    }
    if (!this.configuredKeyCodes.has(e.keycode)) return;
    if (this.activeKeycode !== null) return; // key-repeat debounce — must precede isRecording check
    this.activeKeycode = e.keycode;
    this.armStuckKeyWatchdog();
    const appFocused = w?.isFocused() ?? false;
    // Kick off frontmost-app check immediately — resolves in ~200ms, well before COUNTDOWN_MS.
    const frontmostPromise = !appFocused ? checkFrontmostApp() : Promise.resolve({ name: null, isTextField: false });
    eventLogger.info(LOG, 'Hold started, waiting for threshold', { countdownMs: COUNTDOWN_MS });
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.isRecording = true;
      this.voiceFlowActive = true;
      frontmostPromise
        .then((info) => {
          eventLogger.info(LOG, 'Hold threshold reached, sending start', { appFocused, frontmostApp: info.name });
          if (w && !w.isDestroyed()) {
            w.webContents.send(IPC_EVENTS.VOICE_FLOW_START, { appFocused, frontmostApp: info.name });
          }
        })
        .catch(() => {
          if (w && !w.isDestroyed()) {
            w.webContents.send(IPC_EVENTS.VOICE_FLOW_START, { appFocused, frontmostApp: null });
          }
        });
    }, COUNTDOWN_MS);
  };

  private onKeyUp = (e: UiohookKeyboardEvent): void => {
    if (e.keycode !== this.activeKeycode) return;
    this.clearActiveKey();
    const w = this.getMainWindow?.();
    // Released before hold threshold — abort countdown.
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
      eventLogger.info(LOG, 'Key released before threshold, aborting');
      return;
    }
    // Released while recording — stop and transcribe.
    if (this.isRecording) {
      this.isRecording = false;
      eventLogger.info(LOG, 'Key released, stopping recording');
      if (w && !w.isDestroyed()) w.webContents.send(IPC_EVENTS.VOICE_FLOW_STOP);
    }
  };

  private onVoiceFlowStopped = (): void => {
    // Renderer signals that silence-based auto-stop completed — reset main-side state.
    // Deliberately leave activeKeycode set: the physical key may still be held. Only the real
    // key-up clears it, otherwise key-repeat would re-arm and fire a second recording (or, at
    // OS repeat rate, a runaway start/stop loop that freezes the app).
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.isRecording = false;
    this.voiceFlowActive = false;
  };

  private checkAccessibility(): boolean {
    if (process.platform !== 'darwin') return true;
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
      eventLogger.warn(LOG, 'Accessibility permission not granted; tap-to-record hotkey will not work');
      // Prompt the system dialog so the user can grant it without leaving the app.
      systemPreferences.isTrustedAccessibilityClient(true);
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
    return trusted;
  }

  start(getWindow: () => BrowserWindow | null): void {
    if (this.started) return;
    this.getMainWindow = getWindow;
    const keyName = getStore().get('settings').voiceFlow?.key ?? DEFAULT_KEY;
    this.configuredKeyCodes = resolveKeyCodes(keyName);

    if (!this.checkAccessibility()) {
      eventLogger.warn(LOG, 'Skipping uIOhook start — accessibility permission not granted');
      return;
    }

    uIOhook.on('keydown', this.onKeyDown);
    uIOhook.on('keyup', this.onKeyUp);
    ipcMain.on(IPC_EVENTS.VOICE_FLOW_STOPPED, this.onVoiceFlowStopped);
    try {
      uIOhook.start();
      this.started = true;
      process.on('exit', this.onProcessExit);
      app.on('will-quit', this.onProcessExit);
      eventLogger.info(LOG, 'Voice Flow hotkey initialized', {
        keyName,
        keycodes: [...this.configuredKeyCodes],
        platform: process.platform,
      });
    } catch (err) {
      uIOhook.off('keydown', this.onKeyDown);
      uIOhook.off('keyup', this.onKeyUp);
      ipcMain.off(IPC_EVENTS.VOICE_FLOW_STOPPED, this.onVoiceFlowStopped);
      eventLogger.error(LOG, 'uIOhook.start() failed', { error: (err as Error).message });
      return;
    }

    this.settingsChangeHandler = (settings: AppSettings) => {
      const next = settings.voiceFlow?.key ?? DEFAULT_KEY;
      this.configuredKeyCodes = resolveKeyCodes(next);
      eventLogger.info(LOG, 'Hotkey changed', { keyName: next, keycodes: [...this.configuredKeyCodes] });
    };
    settingsEvents.on('change', this.settingsChangeHandler);
  }

  stop(): void {
    if (this.settingsChangeHandler) {
      settingsEvents.off('change', this.settingsChangeHandler);
      this.settingsChangeHandler = null;
    }
    uIOhook.off('keydown', this.onKeyDown);
    uIOhook.off('keyup', this.onKeyUp);
    ipcMain.off(IPC_EVENTS.VOICE_FLOW_STOPPED, this.onVoiceFlowStopped);
    if (this.started) {
      try {
        uIOhook.stop();
      } catch {
        // best-effort
      }
      this.started = false;
      process.off('exit', this.onProcessExit);
      app.off('will-quit', this.onProcessExit);
    }
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.isRecording = false;
    this.voiceFlowActive = false;
    this.clearActiveKey();
    this.getMainWindow = null;
  }
}

const hotkeyInstance = new VoiceFlowHotkey();

export function initVoiceFlowHotkey(getWindow: () => BrowserWindow | null): void {
  hotkeyInstance.start(getWindow);
}

export function stopVoiceFlowHotkey(): void {
  hotkeyInstance.stop();
}
