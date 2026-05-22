import type { AppSettings } from '../../shared/types';
import { settingsEvents } from '../store/index';

export abstract class BaseBridge<Deps> {
  protected deps: Deps | null = null;
  private settingsChangeHandler: ((s: AppSettings) => void) | null = null;
  private _initialized = false;

  // Re-calling init() with new deps is not supported — second call is a no-op.
  init(deps: Deps): void {
    if (this._initialized) return;
    this._initialized = true;
    this.deps = deps;
    this.onInit(deps);
    this.settingsChangeHandler = (s) => this.applySettings(s);
    settingsEvents.on('change', this.settingsChangeHandler);
  }

  /** Called during init, before settings listener is registered. Override for bridge-specific setup. */
  protected onInit(_deps: Deps): void {}

  /** Unregisters the settings change listener. Call from subclass stop(). */
  protected unregisterSettingsListener(): void {
    if (this.settingsChangeHandler) {
      settingsEvents.off('change', this.settingsChangeHandler);
      this.settingsChangeHandler = null;
    }
  }

  abstract applySettings(settings: AppSettings): void;
}
