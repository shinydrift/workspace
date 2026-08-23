import fs from 'fs';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';

const seededConfigs = new Set<string>();
let seededSettings = false;

// Replaces `file` atomically: write a sibling temp file, then rename it over the target. Under
// Docker the target lives in ~/.claude, which is bind-mounted into every claude container, so a
// plain truncate-and-rewrite here would be visible to a container mid-write as a truncated file —
// exactly the failure the CLI reports as a corrupted configuration file.
function writeFileAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

// Pre-accepts the in-container claude TUI's first-launch onboarding wizard, trust dialog,
// and --dangerously-skip-permissions warning by patching the claude config files the session
// reads. Without this, the interactive TUI blocks on those modals — which swallow the prompt we
// type — and the first turn never reaches the model. (Headless `-p` skips the wizard entirely,
// so only interactive turns are affected.)
//
// Under Docker the session reads ~/.claude/.claude.json via CLAUDE_CONFIG_DIR (~/.claude is
// bind-mounted), leaving the user's own ~/.claude.json untouched. On host there is no container
// and claude reads ~/.claude.json in place, so that is the file to seed.
// Idempotent (no-op if already set), runs at most once per process per target file.
export function seedClaudeHostConfigOnce(userHome: string, runOnHost: boolean): void {
  const claudeDir = path.join(userHome, '.claude');
  const configPath = runOnHost ? path.join(userHome, '.claude.json') : path.join(claudeDir, '.claude.json');
  const configLabel = runOnHost ? '~/.claude.json' : '~/.claude/.claude.json';

  if (!seededConfigs.has(configPath)) {
    seededConfigs.add(configPath);
    try {
      fs.mkdirSync(claudeDir, { recursive: true });
      const exists = fs.existsSync(configPath) && fs.statSync(configPath).isFile();
      let cfg: {
        hasCompletedOnboarding?: boolean;
        theme?: string;
        projects?: Record<string, { hasTrustDialogAccepted?: boolean } & Record<string, unknown>>;
      } = {};

      if (exists) {
        cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } else if (!runOnHost) {
        // First container run: carry over the user's own CLI config (oauthAccount, caches) so the
        // TUI does not start from a blank slate. A one-time copy — that file is never mounted, so
        // the two configs are free to diverge afterwards.
        const userClaudeJson = path.join(userHome, '.claude.json');
        if (fs.existsSync(userClaudeJson) && fs.statSync(userClaudeJson).isFile()) {
          cfg = JSON.parse(fs.readFileSync(userClaudeJson, 'utf8'));
        }
      }
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

      if (dirty || !exists) {
        writeFileAtomic(configPath, JSON.stringify(cfg, null, 2));
        eventLogger.info('auth', `Seeded interactive-TUI onboarding/trust flags in ${configLabel}`);
      }
    } catch (err) {
      eventLogger.warn('auth', `Failed to seed onboarding/trust flags in ${configLabel}`, { error: String(err) });
    }
  }

  if (seededSettings) return;
  seededSettings = true;

  const claudeSettingsHost = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(claudeSettingsHost)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsHost, 'utf8')) as {
        skipDangerousModePermissionPrompt?: boolean;
      } & Record<string, unknown>;
      if (!settings.skipDangerousModePermissionPrompt) {
        settings.skipDangerousModePermissionPrompt = true;
        writeFileAtomic(claudeSettingsHost, JSON.stringify(settings, null, 2));
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
