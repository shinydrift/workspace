import { app } from 'electron';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';
import { PtyProcess } from '../PtyProcess';
import { ClaudeJsonlWatcher, type JsonlEntry } from './ClaudeJsonlWatcher';
import type { TurnEndReason } from '../headlessRunner';
import { buildClaudeInteractiveArgs, type ClaudeInteractiveArgsOpts } from './buildClaudeInteractiveArgs';
import { seedClaudeHostConfigOnce } from './seedClaudeHostConfig';
import { effectiveHostCwd, claudeProjectDirName } from '../effectiveCwd';

// Boot readiness is detected by output QUIESCENCE: once claude's TUI has emitted something and then
// gone quiet for BOOT_QUIET_MS, its initial render (including the input box) has settled. This beats
// acting on the first byte, which often lands mid-boot — before the box is mounted and while MCP
// servers are still wiring up — so the body would be written into a box that isn't listening yet.
// BOOT_READY_TIMEOUT_MS is the overall cap: if the TUI never goes quiet (or never emits at all),
// write anyway and let the submission-confirmation deadline backstop a bad boot.
const BOOT_READY_TIMEOUT_MS = 8_000;
const BOOT_QUIET_MS = 400;

// After writing the prompt, claude must actually start the turn (it writes its first
// JSONL entry on accept). A freshly spawned TUI can swallow the trailing \r (Ink's paste
// detector captures it as paste content) or still be wiring up MCP servers when we write,
// so a single submit is unreliable. Re-send a bare \r on this interval until the input is
// accepted, capped at SUBMIT_MAX_RETRIES so an empty box isn't spammed indefinitely.
const SUBMIT_RETRY_INTERVAL_MS = 2_500;
const SUBMIT_MAX_RETRIES = 8;

// Deliver the prompt body to the TUI in paced chunks rather than one large write. A single large
// write can fill the PTY input buffer faster than a freshly booted Ink TUI drains it, silently
// dropping the tail (including the trailing submit) — large prompts then never land. Chunking with
// a brief inter-chunk delay keeps the reader ahead of the writer. Conservative defaults; tune
// against a large-paste repro if needed.
const WRITE_CHUNK_BYTES = 1_024;
const WRITE_CHUNK_DELAY_MS = 8;

// After the body is fully written, let Ink finish ingesting the paste (and render its placeholder)
// before sending Enter as a SEPARATE keystroke. Concatenating \r onto the body lets the paste
// detector absorb it as content instead of treating it as a submit.
const SUBMIT_SETTLE_MS = 120;

// Body re-delivery (#3). When a sizable body produces no paste placeholder, it never reached the
// box — the tail (and the submit) were dropped on PTY overflow, and re-sending \r can't recover it.
// Only attempt above a size where Ink reliably renders a placeholder when the paste DOES land, so a
// small body's (normal) lack of placeholder isn't mistaken for a drop. Re-delivery is gated on
// no-marker + no-JSONL, which together imply "nothing landed", so it won't double-submit a body
// that's actually in the box. Capped so a persistently wedged TUI hits the submit deadline instead
// of looping. Threshold/interval are conservative — the abort-log telemetry can refine them.
const REDELIVER_MIN_BODY_BYTES = 4_096;
const REDELIVER_CHECK_MS = 3_000;
const REDELIVER_MAX = 3;
// Best-effort clear of any partial paste left in the box before re-delivering (Ctrl-U = kill line).
// If the TUI ignores it the re-delivery may concatenate, but the submit deadline still aborts
// cleanly — so #3 never makes a drop worse than it already is today.
const CLEAR_INPUT_SEQUENCE = '\x15';

// Ink renders a large paste as "[Pasted text #N +X lines] paste again to expand". Its presence
// proves the body reached the input box; its absence for a large body that never submits means the
// body was dropped, not merely unsubmitted. Shared by the submission-retry nudger and the
// drop-vs-swallow telemetry in runTurn.
const PASTE_MARKER_RE = /pasted\s+(text|content)|paste\s+again/i;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

  /** True only while a turn is genuinely mid-flight. Used by autopilot to avoid starting the
   * planner while the main thread's own claude turn is still producing output. No post-turn
   * grace window: `turnInFlight` is cleared only when the JSONL watcher settles on a
   * `turn_duration`/`stop_hook_summary` marker, which claude writes once the entire turn —
   * including trailing tool flushes — is complete. So a recent settle means the turn is done,
   * not still flushing. (The watcher's early/timeout resolution is filtered out upstream before
   * autopilot is triggered, so it can't be observed here either.) */
  isInTurn(): boolean {
    return !this.disposed && this.turnInFlight;
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
    // Claude derives its session JSONL project dir from its cwd, replacing every non-alphanumeric
    // char with '-'. The cwd is /workspace/<subdir> in Docker or the real worktree (+subdir) on
    // host; if the watcher tails the wrong dir the turn never settles (totalEntriesSeen stays 0).
    const projectDirName = claudeProjectDirName(this.workingDirectory, this.args.subdir, this.args.runOnHost ?? false);
    this.watcher = new ClaudeJsonlWatcher(claudeDataDir, projectDirName);
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
    const cwd = effectiveHostCwd(this.workingDirectory, this.args.subdir, this.args.runOnHost ?? false);
    const proc = new PtyProcess(command, args, cwd, this.args.runOnHost ? env : undefined);
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

  // Wait until claude's TUI has rendered and gone quiet (its input box is mounted and listening),
  // or a hard timeout. Readiness = output quiescence: the TUI emits, then stops for BOOT_QUIET_MS.
  // Only called on the first turn of a freshly spawned PTY. If the PTY exits during boot (e.g. claude
  // rejects --session-id as in-use, auth fails), capture the death-throes output and surface it —
  // otherwise the data emitted immediately before exit looks identical to a normal boot, runTurn
  // proceeds to write input to a corpse, and the JSONL watcher hangs forever.
  private waitForBootReady(proc: PtyProcess): Promise<{ exited: false } | { exited: true; output: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let buffer = '';
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        proc.off('data', onData);
        proc.off('exit', onExit);
        clearTimeout(hardTimer);
        if (quietTimer) clearTimeout(quietTimer);
      };
      const finishReady = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ exited: false });
      };
      const onData = (chunk: string): void => {
        buffer += chunk;
        if (settled) return;
        // Ready once output has been quiet for BOOT_QUIET_MS. Each new chunk pushes the deadline
        // out, so a bursty boot (header, then MCP status, then the input box) is followed to
        // completion instead of being acted on at the first byte.
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finishReady, BOOT_QUIET_MS);
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
      const hardTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        eventLogger.warn('claudeIO', 'interactive: boot-ready timeout, writing input anyway', {
          threadId: this.threadId,
          sawOutput: buffer.length > 0,
        });
        resolve({ exited: false });
      }, BOOT_READY_TIMEOUT_MS);
      proc.on('data', onData);
      proc.on('exit', onExit);
    });
  }

  // Backstop for the explicit post-settle \r in runTurn: even decoupled from the body, the submit
  // can fail to land if the TUI is still wiring up MCP servers when it arrives, or Ink captures it
  // as paste content. So re-send a bare \r — once off the paste marker and then on a fixed interval
  // — until claude accepts the input. The caller disposes this as soon as the first JSONL entry
  // proves the input was accepted, so a stray \r after a successful submit is at worst one no-op
  // keystroke. (This only re-sends \r; a body that was dropped entirely is handled separately.)
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
    const onData = (data: string): void => {
      if (PASTE_MARKER_RE.test(data)) {
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

  // Write the body to the PTY in paced chunks (WRITE_CHUNK_BYTES, spaced by WRITE_CHUNK_DELAY_MS)
  // so a large paste can't overflow the input buffer faster than the TUI drains it. Never splits a
  // UTF-16 surrogate pair across a chunk boundary — slicing mid-pair would corrupt that character
  // on the wire. Does NOT send Enter; runTurn submits separately after a settle. `shouldAbort` lets
  // a re-delivery bail mid-write the instant the original submit is observed to have landed.
  private async writeBodyChunked(proc: PtyProcess, body: string, shouldAbort?: () => boolean): Promise<void> {
    let i = 0;
    while (i < body.length) {
      if (shouldAbort?.()) return;
      let end = Math.min(i + WRITE_CHUNK_BYTES, body.length);
      if (end < body.length) {
        const code = body.charCodeAt(end - 1);
        if (code >= 0xd800 && code <= 0xdbff) end -= 1; // high surrogate at boundary → defer to next chunk
      }
      proc.write(body.slice(i, end));
      i = end;
      if (i < body.length) await delay(WRITE_CHUNK_DELAY_MS);
    }
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

    eventLogger.info('claudeIO', 'interactive: writing input to PTY (paced)', {
      threadId: this.threadId,
      bodyLength: body.length,
      sessionId: this.sessionId,
      freshlySpawned,
    });

    // Record whether Ink ever rendered a paste placeholder for this body. For a large body that
    // never submits, the marker's ABSENCE means the body was dropped (PTY overflow) — i.e. a body
    // re-delivery, not another bare \r, is the fix. Flag only; this listener never sends input.
    let pasteMarkerSeen = false;
    const onMarkerData = (data: string): void => {
      if (PASTE_MARKER_RE.test(data)) pasteMarkerSeen = true;
    };
    proc.on('data', onMarkerData);

    try {
      // Clear any input a prior turn left in the box after failing to submit (typically a collapsed
      // paste placeholder that never landed), so this turn's body isn't prepended with stale content.
      // A persistent PTY is reused across turns, so without this a failed turn could corrupt the next.
      proc.write(CLEAR_INPUT_SEQUENCE);
      await delay(WRITE_CHUNK_DELAY_MS);
      // #1 deliver the body in paced chunks so a large paste can't overflow the PTY input buffer.
      // #2 send Enter as a separate keystroke after a settle, so the paste detector doesn't absorb it.
      await this.writeBodyChunked(proc, body);
      await delay(SUBMIT_SETTLE_MS);
      proc.write('\r');
    } catch (err) {
      // A PTY write can throw if the process died mid-write; drop our listener so it doesn't leak,
      // then let the error propagate (the turn fails and the queue drains).
      proc.off('data', onMarkerData);
      throw err;
    }
    const disposeSubmitRetry = this.armSubmissionRetry();

    let firstEntrySeen = false;

    // #3 Body re-delivery. A sizable body that shows no paste marker never reached the box (overflow
    // dropped it), so re-sending \r is useless — re-deliver the body itself. Gated on large body +
    // no marker + no JSONL, which together imply nothing landed, so this won't double-submit a body
    // already in the box. Each attempt clears any partial residue, re-writes (paced), and re-submits;
    // it aborts the instant the original submit lands. Best-effort: if it can't recover, the submit
    // deadline still aborts cleanly.
    let redeliveries = 0;
    let redeliveryInFlight = false;
    const redeliveryTimer =
      body.length >= REDELIVER_MIN_BODY_BYTES
        ? setInterval(() => {
            if (firstEntrySeen || pasteMarkerSeen || redeliveryInFlight) return;
            if (redeliveries >= REDELIVER_MAX) {
              clearInterval(redeliveryTimer ?? undefined);
              return;
            }
            redeliveryInFlight = true;
            redeliveries += 1;
            eventLogger.warn('claudeIO', 'interactive: body not observed in box, re-delivering', {
              threadId: this.threadId,
              attempt: redeliveries,
              bodyLength: body.length,
            });
            void (async () => {
              try {
                if (firstEntrySeen) return;
                proc.write(CLEAR_INPUT_SEQUENCE);
                await delay(WRITE_CHUNK_DELAY_MS);
                await this.writeBodyChunked(proc, body, () => firstEntrySeen);
                if (firstEntrySeen) return;
                await delay(SUBMIT_SETTLE_MS);
                if (!firstEntrySeen) proc.write('\r');
              } catch (err) {
                // Fire-and-forget: a PTY write can throw if the process died mid re-delivery. Swallow
                // it (logged) so it doesn't surface as an unhandled rejection; the submit deadline
                // still aborts the turn cleanly.
                eventLogger.warn('claudeIO', 'interactive: body re-delivery failed', {
                  threadId: this.threadId,
                  attempt: redeliveries,
                  error: String(err),
                });
              } finally {
                redeliveryInFlight = false;
              }
            })();
          }, REDELIVER_CHECK_MS)
        : null;
    const disposeRedelivery = (): void => {
      if (redeliveryTimer) clearInterval(redeliveryTimer);
    };

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
        bodyLength: body.length,
        // false here on a sizable body ⇒ the body never landed (dropped), so re-delivering it —
        // not another \r — is what's needed. This is the signal for whether the re-delivery path
        // is worth building.
        pasteMarkerSeen,
      });
      this.watcher.cancel();
    }, SUBMIT_CONFIRM_TIMEOUT_MS);

    const wrappedOnEntry = (entry: JsonlEntry): void => {
      if (!firstEntrySeen) {
        firstEntrySeen = true;
        // Any JSONL entry proves claude accepted the input: stop nudging \r, stop re-delivery, drop
        // the paste-marker observer, and cancel the submission deadline so a long-running turn isn't
        // aborted mid-response.
        disposeSubmitRetry();
        disposeRedelivery();
        proc.off('data', onMarkerData);
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
      clearTimeout(submitDeadline);
      disposeSubmitRetry();
      disposeRedelivery();
      proc.off('data', onMarkerData);
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
