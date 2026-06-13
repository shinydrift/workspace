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

// After writing the prompt, claude must actually start the turn (it writes its first
// JSONL entry on accept). A freshly spawned TUI can swallow the trailing \r (Ink's paste
// detector captures it as paste content) or still be wiring up MCP servers when we write,
// so a single submit is unreliable. Re-send a bare \r on this interval until the input is
// accepted, capped at SUBMIT_MAX_RETRIES so an empty box isn't spammed indefinitely.
const SUBMIT_RETRY_INTERVAL_MS = 2_500;
const SUBMIT_MAX_RETRIES = 8;

// Hard ceiling on how long we wait for claude to *start* the turn. This is deliberately
// distinct from the turn timeout (timeoutMs), which is unbounded for user turns and so can
// never rescue a submit that never lands — claude would sit at its TUI with the prompt
// unsubmitted and the input queue would wedge forever. If no JSONL entry appears within this
// window the submit failed, so we abort the turn and let the queue drain.
const SUBMIT_CONFIRM_TIMEOUT_MS = 60_000;

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

  // Ink's paste detector treats the early write burst as a paste block, rendering it as
  // "[Pasted text #N +X lines] paste again to expand" — the trailing \r in that burst is
  // captured as paste content rather than a submit; a freshly booted TUI can also still be
  // connecting MCP servers when we write. Either way the first submit may not land, so we
  // re-send a bare \r — once off the paste marker and then on a fixed interval — until claude
  // accepts the input. The caller disposes this as soon as the first JSONL entry proves the
  // input was accepted, so a stray \r after a successful submit is at worst one no-op keystroke.
  private armSubmissionRetry(): () => void {
    const proc = this.pty;
    if (!proc) return () => {};

    let done = false;
    let attempts = 0;
    const dispose = (): void => {
      if (done) return;
      done = true;
      clearInterval(interval);
      proc.off('data', onData);
    };
    const resubmit = (reason: 'paste-marker' | 'interval'): void => {
      if (done) return;
      attempts += 1;
      proc.write('\r');
      eventLogger.info('claudeIO', 'interactive: re-sent \\r to submit input', {
        threadId: this.threadId,
        reason,
        attempts,
      });
      // Stop nudging after the cap; the submission-confirmation deadline in runTurn is the
      // backstop if the input still never landed.
      if (attempts >= SUBMIT_MAX_RETRIES) dispose();
    };
    const pasteMarkerRe = /pasted\s+(text|content)|paste\s+again/i;
    const onData = (data: string): void => {
      if (pasteMarkerRe.test(data)) {
        // Nudge once off the marker, then let the interval handle subsequent retries — the
        // TUI re-renders the placeholder on every redraw, so reacting to each chunk would
        // burn the whole retry budget in a single tick.
        proc.off('data', onData);
        resubmit('paste-marker');
      }
    };
    const interval = setInterval(() => resubmit('interval'), SUBMIT_RETRY_INTERVAL_MS);
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
    const disposeSubmitRetry = this.armSubmissionRetry();

    let firstEntrySeen = false;

    // Submission-confirmation deadline. timeoutMs (the turn timeout) is unbounded for user
    // turns, so it can't catch a submit that never lands. If no JSONL entry appears within
    // SUBMIT_CONFIRM_TIMEOUT_MS, cancel the watcher so the turn fails fast and the queue
    // drains instead of wedging forever behind a prompt the TUI never submitted.
    const submitDeadline = setTimeout(() => {
      if (firstEntrySeen) return;
      eventLogger.warn('claudeIO', 'interactive: input not accepted before deadline, aborting turn', {
        threadId: this.threadId,
        sessionId: this.sessionId,
        timeoutMs: SUBMIT_CONFIRM_TIMEOUT_MS,
      });
      this.watcher.cancel();
    }, SUBMIT_CONFIRM_TIMEOUT_MS);

    const wrappedOnEntry = (entry: JsonlEntry): void => {
      if (!firstEntrySeen) {
        firstEntrySeen = true;
        // Any JSONL entry proves claude accepted the input: stop nudging \r and cancel the
        // submission deadline so a long-running turn isn't aborted mid-response.
        disposeSubmitRetry();
        clearTimeout(submitDeadline);
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
    } catch (err) {
      if (!firstEntrySeen) {
        throw new Error(
          `claude interactive: prompt was not submitted within ${SUBMIT_CONFIRM_TIMEOUT_MS}ms ` +
            `(thread ${this.threadId}, session ${this.sessionId}); the TUI never started the turn`
        );
      }
      throw err;
    } finally {
      this.turnInFlight = false;
      this.lastTurnEndedAt = Date.now();
      clearTimeout(submitDeadline);
      disposeSubmitRetry();
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
