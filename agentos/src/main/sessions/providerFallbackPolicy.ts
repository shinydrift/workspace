import type { Provider, Thread } from '../../shared/types';

type SessionIdField = 'claudeSessionId' | 'codexSessionId' | 'geminiSessionId' | 'piSessionId' | 'opencodeSessionId';

// Where each harness records the session it can `--resume`.
const SESSION_ID_FIELD: Record<Provider, SessionIdField> = {
  claude: 'claudeSessionId',
  'claude-interactive': 'claudeSessionId',
  codex: 'codexSessionId',
  gemini: 'geminiSessionId',
  pi: 'piSessionId',
  opencode: 'opencodeSessionId',
};

/**
 * Whether a usage limit may switch this thread to the next provider in the priority list.
 *
 * A switch restarts the thread against a different CLI, and no provider can resume another's
 * session — so every turn taken so far is dropped, permanently. That trade only pays where there
 * is nothing yet to lose: a thread's very first turn. Past that the limit is surfaced and the
 * thread keeps its provider, so it resumes with its context once the limit clears.
 *
 * "Nothing to lose" is read two ways because neither alone is sound:
 *  - `promptHistory` — `persistUserInput` appends the current prompt *before* the turn runs, so
 *    the first turn is exactly 1. But it ignores sources outside user/automation/autopilot, so a
 *    `skills` turn (`/save-session-chunk`) takes a turn without growing it.
 *  - a persisted session id for the current provider — `persistAllSessionIds` writes it after any
 *    turn that produced one, including those invisible sources. This is the transcript a switch
 *    would strand.
 *
 * Provider-agnostic: a codex→gemini fallback is gated the same way. A first-turn fallback that
 * chains (claude→codex→gemini) still works — the retry passes `persistInput: false`, so the
 * history stays at 1, and the limit hit means the abandoned provider recorded no session.
 */
export function canFallbackProvider(
  thread: Pick<Thread, 'promptHistory' | SessionIdField>,
  currentProvider: Provider
): boolean {
  if (thread.promptHistory.length > 1) return false;
  return !thread[SESSION_ID_FIELD[currentProvider]];
}
