import type { Provider } from '../../shared/types';

const READY_PATTERNS: Record<Provider, RegExp> = {
  claude: /(?:^|\r?\n)(?:>|claude>)\s*$/m,
  'claude-interactive': /(?:^|\r?\n)(?:>|claude>)\s*$/m,
  codex: /(?:^|\r?\n)(?:>|codex>|\$)\s*$/m,
  gemini: /(?:^|\r?\n)(?:>|gemini>)\s*$/m,
  pi: /(?:^|\r?\n)(?:>|pi>|\$)\s*$/m,
  // opencode runs headless (`opencode run`), so this prompt signal is a defensive fallback only.
  opencode: /(?:^|\r?\n)(?:>|opencode>|\$)\s*$/m,
};

export function isCliReady(provider: Provider, output: string): boolean {
  return READY_PATTERNS[provider].test(output);
}
