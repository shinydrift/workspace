import fs from 'fs';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';

let seeded = false;

// Pre-accepts the in-container claude TUI's first-launch trust dialog and the
// --dangerously-skip-permissions warning by patching the host-side claude config
// files that are bind-mounted into the session container. Without this, the
// interactive TUI blocks on those prompts and the first turn never reaches the
// model.
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
        projects?: Record<string, { hasTrustDialogAccepted?: boolean } & Record<string, unknown>>;
      };
      const wsEntry = cfg.projects?.['/workspace'] ?? {};
      if (!wsEntry.hasTrustDialogAccepted) {
        cfg.projects = { ...(cfg.projects ?? {}), '/workspace': { ...wsEntry, hasTrustDialogAccepted: true } };
        fs.writeFileSync(claudeJsonHost, JSON.stringify(cfg, null, 2));
        eventLogger.info('auth', 'Seeded /workspace trust in ~/.claude.json (host-side, once per process)');
      }
    } catch (err) {
      eventLogger.warn('auth', 'Failed to seed /workspace trust in ~/.claude.json', { error: String(err) });
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
