import { app } from 'electron';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';
import { PtyProcess } from '../PtyProcess';
import { ClaudeJsonlWatcher, type JsonlEntry } from './ClaudeJsonlWatcher';
import type { TurnEndReason } from '../headlessRunner';
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
  private turnInFlight = false;
  private lastTurnEndedAt = 0;
  // Hold "in-turn" true briefly after the watcher settles. End_turn_grace can fire
  // while a trailing tool dispatch (e.g. final MCP write) is still flushing to JSONL,
  // so autopilot would otherwise enqueue a follow-up turn before claude is really idle.
  // 1s is enough to soak up the typical trailing-tool window without noticeably delaying
  // legitimate autopilot continuations.
  private static readonly POST_TURN_QUIESCENCE_MS = 1_000;

  /** True while a turn is mid-flight, or within the quiescence window after the
   * watcher settled. Used by autopilot to avoid firing a follow-up turn while
   * claude may still be flushing trailing tool calls. */
  isInTurn(): boolean {
    if (this.disposed) return false;
    if (this.turnInFlight) return true;
    if (this.lastTurnEndedAt === 0) return false;
    return Date.now() - this.lastTurnEndedAt < ClaudeInteractiveSession.POST_TURN_QUIESCENCE_MS;
  }
  // Tracks whether we've spawned claude at least once for this thread's session jsonl.
  // After the first spawn the jsonl exists on disk, so any subsequent respawn (liveness-
  // probe path after macOS sleep, container recreated underneath us, etc.) must use
  // `--resume` rather than `--session-id` to avoid the "session id already in use" exit.
  private hasSpawnedBefore: boolean;

  constructor(
    private readonly threadId: string,
    private readonly sessionId: string,
    private readonly workingDirectory: string,
    private readonly args: ClaudeInteractiveArgsOpts,
    private readonly onDispose: () => void
  ) {
    const claudeDataDir = path.join(app.getPath('home'), '.claude');
    this.watcher = new ClaudeJsonlWatcher(claudeDataDir);
    this.hasSpawnedBefore = args.isResume;
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

    const { command, args, env } = buildClaudeInteractiveArgs({ ...this.args, isResume: this.hasSpawnedBefore });
    eventLogger.info('claudeIO', 'interactive: spawning claude PTY', {
      threadId: this.threadId,
      sessionId: this.sessionId,
      resume: this.hasSpawnedBefore,
    });
    const proc = new PtyProcess(command, args, this.workingDirectory, this.args.runOnHost ? env : undefined);
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
    this.hasSpawnedBefore = true;
    return { proc, freshlySpawned: true };
  }

  // Wait for the TUI to emit anything (proves claude has started) or a hard
  // timeout. Only called on the first turn of a freshly spawned PTY. If the PTY
  // exits during boot (e.g. claude rejects --session-id as in-use, auth fails),
  // capture the death-throes output and surface it — otherwise the data emitted
  // immediately before exit looks identical to a normal boot, runTurn proceeds
  // to write input to a corpse, and the JSONL watcher hangs forever.
  private waitForBootReady(proc: PtyProcess): Promise<{ exited: false } | { exited: true; output: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let buffer = '';
      const cleanup = (): void => {
        proc.off('data', onData);
        proc.off('exit', onExit);
        clearTimeout(timer);
      };
      const onData = (chunk: string): void => {
        buffer += chunk;
        if (settled) return;
        settled = true;
        cleanup();
        // Brief settle delay so the TUI's prompt input box is ready to receive
        // characters rather than catching them mid-render.
        setTimeout(() => resolve({ exited: false }), 300);
      };
      const onExit = (code: number | undefined): void => {
        if (settled) return;
        settled = true;
        cleanup();
        eventLogger.warn('claudeIO', 'interactive: claude PTY exited during boot', {
          threadId: this.threadId,
          exitCode: code,
          output: buffer.slice(-2000),
        });
        resolve({ exited: true, output: buffer });
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        eventLogger.warn('claudeIO', 'interactive: boot-ready timeout, writing input anyway', {
          threadId: this.threadId,
        });
        resolve({ exited: false });
      }, BOOT_READY_TIMEOUT_MS);
      proc.on('data', onData);
      proc.on('exit', onExit);
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

  async runTurn(
    input: string,
    timeoutMs: number | undefined,
    onEntry: (entry: JsonlEntry) => void
  ): Promise<TurnEndReason> {
    if (this.disposed) {
      throw new Error(`Claude interactive session for thread ${this.threadId} has been disposed`);
    }

    const { proc, freshlySpawned } = this.ensureSpawned();

    if (freshlySpawned) {
      eventLogger.info('claudeIO', 'interactive: waiting for claude TUI to boot', {
        threadId: this.threadId,
      });
      const bootResult = await this.waitForBootReady(proc);
      if (bootResult.exited) {
        // PTY exited before reaching the input prompt. Writing input now would race
        // a dead process and the watcher would hang waiting for JSONL output. Fail
        // fast with the captured output so the user sees the real error.
        const trimmed = bootResult.output.trim().slice(-500) || '(no output captured)';
        throw new Error(`claude PTY exited during boot for thread ${this.threadId}: ${trimmed}`);
      }
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

    this.turnInFlight = true;
    try {
      return await this.watcher.watchTurn({
        threadId: this.threadId,
        onEntry: wrappedOnEntry,
        onSessionId: () => {
          // We pre-allocated the session id, so the watcher should already know it.
          // Nothing to do here.
        },
        timeoutMs,
      });
    } finally {
      this.turnInFlight = false;
      this.lastTurnEndedAt = Date.now();
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
