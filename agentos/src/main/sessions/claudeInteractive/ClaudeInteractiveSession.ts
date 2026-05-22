import { app } from 'electron';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';
import { PtyProcess } from '../PtyProcess';
import { ClaudeJsonlWatcher, type JsonlEntry } from './ClaudeJsonlWatcher';
import { buildClaudeInteractiveArgs, type ClaudeInteractiveArgsOpts } from './buildClaudeInteractiveArgs';
import { seedClaudeHostConfigOnce } from './seedClaudeHostConfig';

// Wait up to this long for claude's TUI to emit anything (header, prompt, etc.)
// before writing input. Without this we race claude's boot and the first input
// is silently dropped.
const BOOT_READY_TIMEOUT_MS = 3_000;

// Note: idle teardown is delegated to ContainerManager.scheduleIdleStop from
// execClaudeInteractiveTurn, matching the headless behavior. The container exit
// propagates to our PTY which self-disposes via the 'exit' event handler.

// One persistent claude PTY per thread, attached to the thread's container via
// `docker exec -i`. Inputs are written to the PTY; outputs are tailed from the
// JSONL file claude writes to ~/.claude/projects/-workspace/<session-id>.jsonl.
//
// All paste handling, idle teardown, and turn boundary detection lives here so
// the headless code path (and the rest of TurnExecutor) stays untouched.
export class ClaudeInteractiveSession {
  private pty: PtyProcess | null = null;
  private readonly watcher: ClaudeJsonlWatcher;
  private disposed = false;

  constructor(
    private readonly threadId: string,
    private readonly sessionId: string,
    private readonly workingDirectory: string,
    private readonly args: ClaudeInteractiveArgsOpts,
    private readonly onDispose: () => void
  ) {
    const claudeDataDir = path.join(app.getPath('home'), '.claude');
    this.watcher = new ClaudeJsonlWatcher(claudeDataDir);
  }

  private ensureSpawned(): { proc: PtyProcess; freshlySpawned: boolean } {
    if (this.pty) {
      // Liveness probe: the host PTY process may have died without the 'exit' event
      // firing (e.g. after macOS sleep paused the docker-exec subprocess and the
      // container was recreated underneath us). Writing input to a dead PTY would
      // wedge the turn forever — drop the stale PTY and respawn instead.
      try {
        process.kill(this.pty.pid, 0);
        return { proc: this.pty, freshlySpawned: false };
      } catch {
        eventLogger.warn('claudeIO', 'interactive: discarding dead PTY, respawning', {
          threadId: this.threadId,
          pid: this.pty.pid,
        });
        try {
          this.pty.kill();
        } catch {
          // already dead
        }
        this.pty = null;
      }
    }

    // Pre-accept the in-container TUI's trust + skip-permissions dialogs by
    // patching the host-side claude config. Without this, the TUI blocks
    // and the first turn never reaches the model.
    seedClaudeHostConfigOnce(app.getPath('home'));

    const { command, args } = buildClaudeInteractiveArgs(this.args);
    eventLogger.info('claudeIO', 'interactive: spawning claude PTY', {
      threadId: this.threadId,
      sessionId: this.sessionId,
    });
    const proc = new PtyProcess(command, args, this.workingDirectory);
    proc.on('exit', (code) => {
      eventLogger.info('claudeIO', 'interactive: claude PTY exited', {
        threadId: this.threadId,
        exitCode: code,
      });
      // Identity check: ensureSpawned may have already replaced this.pty with a
      // freshly-spawned one after detecting the previous PTY was dead. Disposing
      // here would kill the fresh PTY. Only dispose if this exit is from the PTY
      // we still consider current.
      if (this.pty !== proc) return;
      this.dispose();
    });
    this.pty = proc;
    return { proc, freshlySpawned: true };
  }

  // Wait for the TUI to emit anything (proves claude has started) or a hard
  // timeout. Only called on the first turn of a freshly spawned PTY.
  private waitForBootReady(proc: PtyProcess): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const onData = (): void => {
        if (settled) return;
        settled = true;
        proc.off('data', onData);
        clearTimeout(timer);
        // Brief settle delay so the TUI's prompt input box is ready to receive
        // characters rather than catching them mid-render.
        setTimeout(resolve, 300);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.off('data', onData);
        eventLogger.warn('claudeIO', 'interactive: boot-ready timeout, writing input anyway', {
          threadId: this.threadId,
        });
        resolve();
      }, BOOT_READY_TIMEOUT_MS);
      proc.on('data', onData);
    });
  }

  // Ink's paste detector treats early-buffered PTY writes as a paste block,
  // rendering them as "[Pasted text #N +X lines] paste again to expand" — the
  // trailing \r in that burst is captured as paste content rather than a submit.
  // Send a follow-up \r outside the original write burst when the marker appears,
  // with an 8s fallback. The stray \r after a successful submit is benign.
  private armPastePlaceholderSubmit(): () => void {
    const proc = this.pty;
    if (!proc) return () => {};

    let done = false;
    const dispose = (): void => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      proc.off('data', onData);
    };
    const submit = (reason: 'paste-marker' | 'fallback-timer'): void => {
      if (done) return;
      dispose();
      proc.write('\r');
      eventLogger.info('claudeIO', 'interactive: sent follow-up \\r to submit paste', {
        threadId: this.threadId,
        reason,
      });
    };
    const pasteMarkerRe = /pasted\s+(text|content)|paste\s+again/i;
    const onData = (data: string): void => {
      if (pasteMarkerRe.test(data)) submit('paste-marker');
    };
    const fallback = setTimeout(() => submit('fallback-timer'), 8_000);
    proc.on('data', onData);
    return dispose;
  }

  async runTurn(input: string, timeoutMs: number | undefined, onEntry: (entry: JsonlEntry) => void): Promise<void> {
    if (this.disposed) {
      throw new Error(`Claude interactive session for thread ${this.threadId} has been disposed`);
    }

    const { proc, freshlySpawned } = this.ensureSpawned();

    if (freshlySpawned) {
      eventLogger.info('claudeIO', 'interactive: waiting for claude TUI to boot', {
        threadId: this.threadId,
      });
      await this.waitForBootReady(proc);
      eventLogger.info('claudeIO', 'interactive: claude TUI booted', { threadId: this.threadId });
    }

    const body = input.endsWith('\n') ? input.slice(0, -1) : input;
    this.watcher.prepareForTurn(this.sessionId);

    eventLogger.info('claudeIO', 'interactive: writing input + \\r to PTY', {
      threadId: this.threadId,
      bodyLength: body.length,
      sessionId: this.sessionId,
      freshlySpawned,
    });
    proc.write(body + '\r');
    const disposePasteWatcher = this.armPastePlaceholderSubmit();

    let firstEntrySeen = false;
    const wrappedOnEntry = (entry: JsonlEntry): void => {
      if (!firstEntrySeen) {
        firstEntrySeen = true;
        // Any JSONL entry proves claude accepted the input; cancel the fallback \r
        // so it doesn't fire mid-response.
        disposePasteWatcher();
      }
      onEntry(entry);
    };

    try {
      await this.watcher.watchTurn({
        threadId: this.threadId,
        onEntry: wrappedOnEntry,
        onSessionId: () => {
          // We pre-allocated the session id, so the watcher should already know it.
          // Nothing to do here.
        },
        timeoutMs,
      });
    } finally {
      disposePasteWatcher();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.watcher.cancel();
    } catch {
      // best-effort
    }
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // already dead
      }
      this.pty = null;
    }
    this.onDispose();
  }
}
