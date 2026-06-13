import fs from 'fs';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';

let seeded = false;

// Pre-accepts the in-container claude TUI's first-launch onboarding wizard, trust dialog,
// and --dangerously-skip-permissions warning by patching the host-side claude config files
// that are bind-mounted into the session container. Without this, the interactive TUI blocks
// on those modals — which swallow the prompt we type — and the first turn never reaches the
// model. (Headless `-p` skips the wizard entirely, so only interactive turns are affected.)
//
// Side effect: mutates the user's HOST ~/.claude.json and ~/.claude/settings.json.
// Idempotent (no-op if already set), runs at most once per process.
export function seedClaudeHostConfigOnce(userHome: string): void {
  if (seeded) return;
  seeded = true;

  const claudeJsonHost = path.join(userHome, '.claude.json');
  if (fs.existsSync(claudeJsonHost) && fs.statSync(claudeJsonHost).isFile()) {
    try {
      const cfg = JSON.parse(fs.readFileSync(claudeJsonHost, 'utf8')) as {
        hasCompletedOnboarding?: boolean;
        theme?: string;
        projects?: Record<string, { hasTrustDialogAccepted?: boolean } & Record<string, unknown>>;
      };
      let dirty = false;

      // The interactive TUI runs its first-launch onboarding wizard (theme picker, then
      // login-method picker) unless onboarding is marked complete. Those modals capture the
      // prompt keystrokes instead of the input box, so the turn never starts. Auth itself
      // comes from the mounted oauthAccount / CLAUDE_CODE_OAUTH_TOKEN, so completing
      // onboarding is purely about skipping the wizard.
      if (cfg.hasCompletedOnboarding !== true) {
        cfg.hasCompletedOnboarding = true;
        dirty = true;
      }
      // Seed a theme only when absent so the theme picker doesn't appear; never override a
      // theme the user has already chosen.
      if (cfg.theme === undefined) {
        cfg.theme = 'dark';
        dirty = true;
      }

      const wsEntry = cfg.projects?.['/workspace'] ?? {};
      if (!wsEntry.hasTrustDialogAccepted) {
        cfg.projects = { ...(cfg.projects ?? {}), '/workspace': { ...wsEntry, hasTrustDialogAccepted: true } };
        dirty = true;
      }

      if (dirty) {
        fs.writeFileSync(claudeJsonHost, JSON.stringify(cfg, null, 2));
        eventLogger.info('auth', 'Seeded interactive-TUI onboarding/trust flags in ~/.claude.json (host-side)');
      }
    } catch (err) {
      eventLogger.warn('auth', 'Failed to seed onboarding/trust flags in ~/.claude.json', { error: String(err) });
    }
  }

  const claudeSettingsHost = path.join(userHome, '.claude', 'settings.json');
  if (fs.existsSync(claudeSettingsHost)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsHost, 'utf8')) as {
        skipDangerousModePermissionPrompt?: boolean;
      } & Record<string, unknown>;
      if (!settings.skipDangerousModePermissionPrompt) {
        settings.skipDangerousModePermissionPrompt = true;
        fs.writeFileSync(claudeSettingsHost, JSON.stringify(settings, null, 2));
        eventLogger.info(
          'auth',
          'Seeded skipDangerousModePermissionPrompt in ~/.claude/settings.json (host-side, once per process)'
        );
      }
    } catch (err) {
      eventLogger.warn('auth', 'Failed to seed skipDangerousModePermissionPrompt in ~/.claude/settings.json', {
        error: String(err),
      });
    }
  }
}
