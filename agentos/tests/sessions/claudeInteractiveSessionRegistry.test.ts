/**
 * Tests for sessions/claudeInteractive/sessionRegistry — disposeThread.
 *
 * Guards the fix for the "thread replies go unanswered after idle stop" bug:
 * thread shutdown must dispose a thread's claude-interactive session so its inner
 * `docker exec` PTY can't outlive the container and wedge the next turn. The real
 * session disposes its inner PTY and removes itself from the registry via its
 * onDispose callback — both modeled by the fake below.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { claudeInteractiveSessions } from '../../src/main/sessions/claudeInteractive/sessionRegistry';
import type { ClaudeInteractiveSession } from '../../src/main/sessions/claudeInteractive/ClaudeInteractiveSession';

// Minimal stand-in for ClaudeInteractiveSession: dispose() bumps a counter and
// removes itself from the registry, mirroring the real onDispose → delete wiring.
function makeFakeSession(threadId: string): { session: ClaudeInteractiveSession; disposeCount: () => number } {
  let count = 0;
  const session = {
    dispose(): void {
      count++;
      claudeInteractiveSessions.delete(threadId);
    },
  } as unknown as ClaudeInteractiveSession;
  return { session, disposeCount: () => count };
}

test('disposeThread disposes the registered session and clears the entry', () => {
  const { session, disposeCount } = makeFakeSession('t1');
  claudeInteractiveSessions.set('t1', session);

  claudeInteractiveSessions.disposeThread('t1');

  assert.equal(disposeCount(), 1, 'session.dispose() should be called exactly once');
  assert.equal(claudeInteractiveSessions.get('t1'), undefined, 'registry entry should be gone after dispose');
});

test('disposeThread is a no-op when no session exists', () => {
  assert.doesNotThrow(() => claudeInteractiveSessions.disposeThread('missing'));
  assert.equal(claudeInteractiveSessions.get('missing'), undefined);
});

test('disposeThread on an already-disposed thread does not throw or re-dispose', () => {
  const { session, disposeCount } = makeFakeSession('t2');
  claudeInteractiveSessions.set('t2', session);

  claudeInteractiveSessions.disposeThread('t2');
  // Second call: entry already removed, so dispose must not run again.
  claudeInteractiveSessions.disposeThread('t2');

  assert.equal(disposeCount(), 1, 'dispose should not run a second time once the entry is cleared');
});
