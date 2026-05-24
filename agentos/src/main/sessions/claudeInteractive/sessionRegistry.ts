import type { ClaudeInteractiveSession } from './ClaudeInteractiveSession';

// One claude-interactive PTY session per thread. The session disposes itself on
// PTY exit and on idle teardown; we drop the registry entry from inside its
// onDispose callback so the next turn for that thread spawns a fresh session.
const sessions = new Map<string, ClaudeInteractiveSession>();

export const claudeInteractiveSessions = {
  get(threadId: string): ClaudeInteractiveSession | undefined {
    return sessions.get(threadId);
  },
  // True when a claude-interactive turn is currently in flight for this thread.
  // Used by autopilot to avoid firing a follow-up turn while the in-container claude
  // is still working — the watcher's silence_fallback can resolve runTurn() before
  // the model is actually done writing.
  isInTurn(threadId: string): boolean {
    return sessions.get(threadId)?.isInTurn() ?? false;
  },
  set(threadId: string, session: ClaudeInteractiveSession): void {
    sessions.set(threadId, session);
  },
  delete(threadId: string): void {
    sessions.delete(threadId);
  },
  // Synchronously tear down one thread's session (and its inner `docker exec` PTY).
  // Called from thread shutdown so a stale session can't outlive its container and
  // wedge the next turn by writing input into a dead exec. dispose() removes the
  // registry entry via its onDispose callback. No-op if no session exists.
  disposeThread(threadId: string): void {
    sessions.get(threadId)?.dispose();
  },
  disposeAll(): void {
    for (const s of sessions.values()) s.dispose();
    sessions.clear();
  },
};
