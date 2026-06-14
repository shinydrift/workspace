import fs from 'fs';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';
import type { TurnEndReason } from '../headlessRunner';

export type JsonlEntry = {
  type: string;
  role?: string;
  message?: unknown;
  [key: string]: unknown;
};

// Typed views over the loose JSONL `message` field. The wire shape is whatever claude-code
// happens to write today; these helpers narrow it just enough for our consumers without
// pretending we own the schema.
type AssistantContentBlock = { type?: string; id?: string };
type AssistantMessage = {
  id?: string;
  content?: AssistantContentBlock[];
  stop_reason?: string;
  usage?: unknown;
};
type UserContentBlock = { type?: string; tool_use_id?: string };

function assistantMsg(entry: JsonlEntry | null | undefined): AssistantMessage | undefined {
  if (!entry || entry.type !== 'assistant') return undefined;
  return (entry.message as AssistantMessage | undefined) ?? undefined;
}

function userContent(entry: JsonlEntry): UserContentBlock[] {
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content as UserContentBlock[]) : [];
}

const SESSION_DIR_WATCH_TIMEOUT_MS = 10_000;

// claude-interactive writes one of these system entries when (and only when) the entire
// turn — including every tool call — is complete. `turn_duration` is the always-emitted
// timing record; `stop_hook_summary` is added when a Stop hook fires. Either one is the
// CLI's own statement that the turn is done, so settling on it needs no grace window and
// no pending-tool gate (any tool_use IDs we're still tracking are stale).
const TURN_END_SYSTEM_SUBTYPES = new Set(['turn_duration', 'stop_hook_summary']);

type PreparedState = {
  sessionId: string | null;
  existingSnapshot: Set<string> | null; // non-null for first-turn only
  startPos: number; // 0 for first-turn, current EOF for resume
  preparedAt: number; // for subtracting elapsed time from timeout budget
};

/**
 * Watches Claude Code's JSONL session file for output during interactive (non-headless) turns.
 * Claude appends entries to ~/.claude/projects/-workspace/<sessionId>.jsonl as it processes each turn.
 * This replaces PTY stream-json parsing as the canonical output channel for interactive claude.
 *
 * Usage: call prepareForTurn() synchronously BEFORE sending input to avoid racing the JSONL
 * file creation, then call watchTurn() to await turn completion.
 *
 * `projectDirName` is Claude Code's project-dir name, derived from claude's cwd by replacing
 * every non-alphanumeric char with '-'. In Docker the cwd is always /workspace (→ '-workspace');
 * on host it is the real worktree path, so the caller must slugify it the same way or this
 * watcher tails the wrong directory and never sees the turn's output.
 */
export class ClaudeJsonlWatcher {
  private readonly projectDir: string;
  private cancelFn: (() => void) | null = null;
  private prepared: PreparedState | null = null;

  constructor(claudeDataDir: string, projectDirName: string) {
    this.projectDir = path.join(claudeDataDir, 'projects', projectDirName);
  }

  /**
   * Synchronous pre-flight: snapshot directory state (first turn) or seek to current EOF
   * (resume). Must be called BEFORE writing input so no JSONL events are missed.
   */
  prepareForTurn(sessionId: string | null): void {
    fs.mkdirSync(this.projectDir, { recursive: true });

    let existingSnapshot: Set<string> | null = null;
    let startPos = 0;

    if (!sessionId) {
      try {
        existingSnapshot = new Set(fs.readdirSync(this.projectDir).filter((f) => f.endsWith('.jsonl')));
      } catch {
        existingSnapshot = new Set();
      }
    } else {
      const jsonlPath = path.join(this.projectDir, `${sessionId}.jsonl`);
      try {
        startPos = fs.statSync(jsonlPath).size;
      } catch {
        startPos = 0;
      }
    }

    this.prepared = { sessionId, existingSnapshot, startPos, preparedAt: Date.now() };
    // Arm cancelFn immediately so cancel() works even before watchTurn() takes over.
    this.cancelFn = () => {
      this.prepared = null;
      this.cancelFn = null;
    };
  }

  async watchTurn(opts: {
    threadId: string;
    onEntry: (entry: JsonlEntry) => void;
    onSessionId: (sessionId: string) => void;
    timeoutMs?: number;
  }): Promise<TurnEndReason> {
    const { threadId, onEntry, onSessionId, timeoutMs } = opts;

    const prep = this.prepared;
    this.prepared = null;

    // Cover any cancel() call in the window between detectNewJsonl resolving and tailFile
    // setting its own cancelFn.
    let cancelled = false;
    this.cancelFn = () => {
      cancelled = true;
      this.cancelFn = null;
    };

    const elapsed = prep ? Date.now() - prep.preparedAt : 0;
    const budgetMs = timeoutMs !== undefined ? timeoutMs - elapsed : undefined;

    let jsonlPath: string;
    let startPos: number;

    if (prep?.sessionId) {
      jsonlPath = path.join(this.projectDir, `${prep.sessionId}.jsonl`);
      startPos = prep.startPos;
    } else {
      const existing =
        prep?.existingSnapshot ??
        (() => {
          try {
            return new Set(fs.readdirSync(this.projectDir).filter((f) => f.endsWith('.jsonl')));
          } catch {
            return new Set<string>();
          }
        })();

      const detectMs = budgetMs !== undefined ? Math.max(100, budgetMs) : undefined;
      jsonlPath = await this.detectNewJsonl(threadId, existing, detectMs);

      if (cancelled) throw new Error('JSONL watcher cancelled');

      const newId = path.basename(jsonlPath, '.jsonl');
      eventLogger.info('thread', 'Detected new Claude session JSONL', { threadId, sessionId: newId });
      onSessionId(newId);
      startPos = 0;
    }

    return this.tailFile(threadId, jsonlPath, startPos, onEntry);
  }

  cancel(): void {
    this.cancelFn?.();
    this.cancelFn = null;
  }

  private detectNewJsonl(threadId: string, existing: Set<string>, timeoutMs?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const detectStart = Date.now();
      const effectiveTimeoutMs = timeoutMs ?? SESSION_DIR_WATCH_TIMEOUT_MS;
      eventLogger.info('claudeIO', 'watcher: detect-new-JSONL begin', {
        threadId,
        existingCount: existing.size,
        timeoutMs: effectiveTimeoutMs,
        projectDir: this.projectDir,
      });
      let settled = false;
      const settle = (file?: string, err?: Error): void => {
        if (settled) return;
        settled = true;
        try {
          dirWatcher.close();
        } catch {
          // best-effort cleanup; dirWatcher may already be closed
        }
        clearTimeout(timer);
        this.cancelFn = null;
        if (err) {
          eventLogger.warn('claudeIO', 'watcher: detect-new-JSONL failed', {
            threadId,
            durationMs: Date.now() - detectStart,
            error: String(err),
          });
          reject(err);
        } else {
          eventLogger.info('claudeIO', 'watcher: detect-new-JSONL success', {
            threadId,
            durationMs: Date.now() - detectStart,
            file: file ? path.basename(file) : undefined,
          });
          resolve(file!);
        }
      };

      const dirWatcher = fs.watch(this.projectDir, (_event, filename) => {
        if (!filename || !filename.endsWith('.jsonl') || existing.has(filename)) return;
        settle(path.join(this.projectDir, filename));
      });

      const timer = setTimeout(
        () => settle(undefined, new Error(`Timeout waiting for Claude session JSONL (thread ${threadId})`)),
        effectiveTimeoutMs
      );

      this.cancelFn = () => settle(undefined, new Error('JSONL watcher cancelled'));
    });
  }

  private tailFile(
    threadId: string,
    jsonlPath: string,
    startPos: number,
    onEntry: (entry: JsonlEntry) => void
  ): Promise<TurnEndReason> {
    return new Promise<TurnEndReason>((resolve, reject) => {
      const tailStart = Date.now();
      let pos = startPos;
      let tail = '';
      let hasSeenAssistant = false;
      let settled = false;
      let totalEntriesSeen = 0;
      let assistantEntriesSeen = 0;
      // Cumulative tool_result count across the whole turn; logged once at settle to avoid
      // per-resolve log spam (a turn with 20 tool calls would otherwise produce 20 lines).
      let toolResultsResolved = 0;
      // Diagnostic only — claude wrote turn_duration regardless of what we tallied here,
      // so leftovers at settle just mean the JSONL didn't surface the matching tool_result
      // through the main file (subagent/MCP boundary), not that the turn was incomplete.
      const pendingToolUseIds = new Set<string>();

      // Interactive claude appends one JSONL entry per content block (thinking, tool_use,
      // text) under the same message.id. Emitting each fragment to the UI shows the same
      // assistant message 3-5 times with growing content. Buffer fragments by message.id
      // and emit a single merged entry once the message is known to be complete (a new
      // message.id appears, a non-assistant entry arrives, or the turn settles).
      let pendingAssistant: JsonlEntry | null = null;
      const flushPendingAssistant = (): void => {
        if (pendingAssistant) {
          onEntry(pendingAssistant);
          pendingAssistant = null;
        }
      };

      const settle = (reason: TurnEndReason, err?: Error): void => {
        if (settled) return;
        settled = true;
        try {
          fs.unwatchFile(jsonlPath);
        } catch {
          // best-effort cleanup; watcher may already be torn down
        }
        if (!err) flushPendingAssistant();
        eventLogger.info('claudeIO', 'watcher: turn settled', {
          threadId,
          reason: err ? 'error' : reason,
          durationMs: Date.now() - tailStart,
          totalEntriesSeen,
          assistantEntriesSeen,
          toolResultsResolved,
          pendingToolUseIds: pendingToolUseIds.size,
          pendingToolUseSample: Array.from(pendingToolUseIds).slice(0, 3),
          error: err ? String(err) : undefined,
        });
        this.cancelFn = null;
        if (err) reject(err);
        else resolve(reason);
      };

      // Set when the loop parses a turn-end system marker. We finish draining the rest of
      // the batch (so trailing entries — last-prompt, ai-title, pr-link, an extra system
      // marker — still reach onEntry) and then settle after the loop.
      let settleReason: TurnEndReason | null = null;

      const handleNewBytes = (newSize: number): void => {
        if (newSize <= pos) return;
        let buf: Buffer;
        try {
          buf = Buffer.alloc(newSize - pos);
          const fd = fs.openSync(jsonlPath, 'r');
          fs.readSync(fd, buf, 0, buf.length, pos);
          fs.closeSync(fd);
        } catch {
          return;
        }
        pos = newSize;

        tail += buf.toString('utf8');
        const lines = tail.split('\n');
        tail = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let entry: JsonlEntry;
          try {
            entry = JSON.parse(trimmed) as JsonlEntry;
          } catch {
            // incomplete or non-JSON line — skip
            continue;
          }
          totalEntriesSeen += 1;

          if (entry.type === 'assistant') {
            assistantEntriesSeen += 1;
            const msg = assistantMsg(entry);
            const pendingMsg = assistantMsg(pendingAssistant);
            if (pendingAssistant && pendingMsg && msg && pendingMsg.id === msg.id) {
              pendingMsg.content = [...(pendingMsg.content ?? []), ...(msg.content ?? [])];
              if (msg.stop_reason !== undefined) pendingMsg.stop_reason = msg.stop_reason;
              if (msg.usage !== undefined) pendingMsg.usage = msg.usage;
            } else {
              flushPendingAssistant();
              pendingAssistant = entry;
            }
            if (!hasSeenAssistant) {
              eventLogger.info('claudeIO', 'watcher: first assistant entry observed', {
                threadId,
                elapsedMs: Date.now() - tailStart,
                messageId: msg?.id,
              });
              hasSeenAssistant = true;
            }
            for (const block of msg?.content ?? []) {
              if (block.type === 'tool_use' && typeof block.id === 'string') {
                pendingToolUseIds.add(block.id);
              }
            }
            continue;
          }

          flushPendingAssistant();
          onEntry(entry);

          if (entry.type === 'user') {
            for (const block of userContent(entry)) {
              if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                if (pendingToolUseIds.delete(block.tool_use_id)) toolResultsResolved += 1;
              }
            }
            continue;
          }

          // The only settle trigger: a `system` entry whose subtype claude-interactive uses
          // to mark end-of-turn. When this lands, the turn is done by definition — no grace
          // window, no pending-tool gate. Everything else (api_error retry, compact_boundary,
          // permission-mode, etc.) is mid-turn and ignored.
          //
          // Gate on hasSeenAssistant as defense-in-depth: a stale turn_duration flushed at
          // startPos (resume race) or a future wire-format change emitting the same subtype
          // for a non-turn-end event would otherwise settle a turn before any model output.
          if (
            settleReason === null &&
            hasSeenAssistant &&
            entry.type === 'system' &&
            typeof entry.subtype === 'string' &&
            TURN_END_SYSTEM_SUBTYPES.has(entry.subtype)
          ) {
            settleReason = entry.subtype as TurnEndReason;
          }
        }

        if (settleReason !== null) settle(settleReason);
      };

      this.cancelFn = () => settle('timeout', new Error('JSONL watcher cancelled'));

      fs.watchFile(jsonlPath, { interval: 200, persistent: false }, (curr) => {
        handleNewBytes(curr.size);
      });

      // Drain any bytes that arrived between prepareForTurn() and now.
      try {
        const curr = fs.statSync(jsonlPath);
        if (curr.size > pos) handleNewBytes(curr.size);
      } catch {
        // file may not exist yet on first poll — watchFile will fire when it does
      }
    });
  }
}
