import { powerSaveBlocker } from 'electron';
import { eventLogger } from './eventLog';
import type { KeepAwakeMode } from '../../shared/types';

/**
 * Holds a `prevent-display-sleep` power blocker so the screen doesn't sleep — and so the lock that
 * follows display sleep / the screensaver doesn't fire. Distinct from the app's permanent
 * `prevent-app-suspension` blocker, which keeps the *system* awake but deliberately lets the
 * display sleep.
 *
 * Blockers are process-wide and focus-independent, so one instance covers the app in the
 * foreground and in the background alike. Platform limits: this does not defeat a manual lock
 * (⌃⌘Q on macOS), an MDM/Group Policy forced lock, or a standalone Linux lock daemon.
 */
export class DisplaySleepBlocker {
  private blockerId: number | null = null;
  private turnActive = false;

  constructor(private mode: KeepAwakeMode) {
    this.sync();
  }

  setMode(mode: KeepAwakeMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.sync();
  }

  setTurnActive(active: boolean): void {
    if (active === this.turnActive) return;
    this.turnActive = active;
    this.sync();
  }

  /** Releases the blocker; the instance is inert afterwards until setMode() is called again. */
  dispose(): void {
    this.mode = 'off';
    this.turnActive = false;
    this.sync();
  }

  isHeld(): boolean {
    return this.blockerId !== null;
  }

  private shouldHold(): boolean {
    return this.mode === 'always' || (this.mode === 'while-active' && this.turnActive);
  }

  private sync(): void {
    const wanted = this.shouldHold();
    if (wanted === this.isHeld()) return;

    if (wanted) {
      this.blockerId = powerSaveBlocker.start('prevent-display-sleep');
      eventLogger.info('power', 'Display sleep blocked', { mode: this.mode });
      return;
    }

    if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) {
      powerSaveBlocker.stop(this.blockerId);
    }
    this.blockerId = null;
    eventLogger.info('power', 'Display sleep unblocked', { mode: this.mode });
  }
}
