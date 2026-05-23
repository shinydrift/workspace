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

// Silence-based fallback for turns that never emit stop_reason="end_turn" (interrupts,
// crashes). Generous so we don't cut off long-running tool sequences.
const TURN_SILENCE_MS = 30_000;
// Once stop_reason="end_turn" arrives, give claude a brief window to flush any trailing
// entries (final tool_result, usage summary) before resolving the turn.
const TURN_END_GRACE_MS = 500;
const SESSION_DIR_WATCH_TIMEOUT_MS = 10_000;

// `system` JSONL entries cover several lifecycle events; only these subtypes signal a real
// turn end. Anything else (api_error retry, compact_boundary, etc.) is mid-turn and must
// not arm the system-marker grace timer — that would resolve the turn while claude is
// still working, and autopilot would fire prematurely.
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
 * The '-workspace' subdirectory is Claude Code's fixed project-dir name when the working
 * directory is /workspace — it strips the leading '/' and replaces '/' with '-'.
 */
export class ClaudeJsonlWatcher {
  private readonly projectDir: string;
  private cancelFn: (() => void) | null = null;
  private prepared: PreparedState | null = null;

  constructor(claudeDataDir: string) {
    this.projectDir = path.join(claudeDataDir, 'projects', '-workspace');
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

    // Recompute remaining budget after detection phase.
    const tailMs =
      timeoutMs !== undefined && prep ? Math.max(100, timeoutMs - (Date.now() - prep.preparedAt)) : timeoutMs;

    return this.tailFile(threadId, jsonlPath, startPos, onEntry, tailMs);
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
    onEntry: (entry: JsonlEntry) => void,
    timeoutMs?: number
  ): Promise<TurnEndReason> {
    return new Promise<TurnEndReason>((resolve, reject) => {
      const tailStart = Date.now();
      let pos = startPos;
      let tail = '';
      let hasSeenAssistant = false;
      let endTurnSeen = false;
      let systemMarkerSeen = false;
      let silenceTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let settled = false;
      // Last reason the silence timer was set, for diagnostic logging at settle().
      let lastSilenceReason: 'none' | 'end_turn_grace' | 'system_marker_grace' | 'silence_fallback' = 'none';
      let totalEntriesSeen = 0;
      let assistantEntriesSeen = 0;
      // Cumulative tool_result count across the whole turn; logged once at settle to avoid
      // per-resolve log spam (a turn with 20 tool calls would otherwise produce 20 lines).
      let toolResultsResolved = 0;

      // Track tool_use IDs that have been issued by the assistant but not yet resolved
      // by a matching tool_result entry. Long-running tools (subagents, MCP calls) can go
      // 30s+ without writing to the main JSONL, which previously tripped the silence
      // fallback mid-turn — autopilot then saw an incomplete response. While anything is
      // pending, only end_turn / system marker may settle the turn.
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

      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(silenceTimer);
        clearTimeout(timeoutTimer);
        try {
          fs.unwatchFile(jsonlPath);
        } catch {
          // best-effort cleanup; watcher may already be torn down
        }
        if (!err) flushPendingAssistant();
        const reason: TurnEndReason = endTurnSeen
          ? 'end_turn'
          : systemMarkerSeen
            ? 'system_marker'
            : 'silence_fallback';
        eventLogger.info('claudeIO', 'watcher: turn settled', {
          threadId,
          reason: err ? 'error' : reason,
          durationMs: Date.now() - tailStart,
          totalEntriesSeen,
          assistantEntriesSeen,
          toolResultsResolved,
          pendingToolUseIds: pendingToolUseIds.size,
          pendingToolUseSample: Array.from(pendingToolUseIds).slice(0, 3),
          lastSilenceReason,
          error: err ? String(err) : undefined,
        });
        if (!err && pendingToolUseIds.size > 0) {
          eventLogger.warn('claudeIO', 'watcher: turn settled with unresolved tool_use IDs', {
            threadId,
            pendingCount: pendingToolUseIds.size,
            ids: Array.from(pendingToolUseIds).slice(0, 5),
            reason,
          });
        }
        this.cancelFn = null;
        if (err) reject(err);
        else resolve(reason);
      };

      // Turn-end detection (in priority order):
      //   1. assistant entry with stop_reason="end_turn" (clean text reply, no tools)
      //   2. a "system" entry written after the last tool_result — interactive claude's
      //      actual turn-end marker when the response is delivered via tool calls
      //      (e.g. Slack post_update), since no final assistant/end_turn entry is emitted
      //   3. silence fallback (TURN_SILENCE_MS) for interrupted/crashed turns
      const resetSilence = (): void => {
        clearTimeout(silenceTimer);
        if (!hasSeenAssistant) return;
        // Tool call in flight — do not silence-settle on any branch; wait for tool_result
        // + next entries. (end_turn followed by trailing tool_result is normal; settling
        // here would resolve the turn before the assistant's tool finishes.)
        if (pendingToolUseIds.size > 0) return;
        if (endTurnSeen || systemMarkerSeen) {
          lastSilenceReason = endTurnSeen ? 'end_turn_grace' : 'system_marker_grace';
          silenceTimer = setTimeout(() => settle(), TURN_END_GRACE_MS);
          return;
        }
        lastSilenceReason = 'silence_fallback';
        silenceTimer = setTimeout(() => settle(), TURN_SILENCE_MS);
      };

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
          try {
            const entry = JSON.parse(trimmed) as JsonlEntry;
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
              if (msg?.stop_reason === 'end_turn' && !endTurnSeen) {
                endTurnSeen = true;
                eventLogger.info('claudeIO', 'watcher: end_turn observed', {
                  threadId,
                  elapsedMs: Date.now() - tailStart,
                  messageId: msg.id,
                });
              }
              for (const block of msg?.content ?? []) {
                if (block.type === 'tool_use' && typeof block.id === 'string') {
                  pendingToolUseIds.add(block.id);
                }
              }
            } else {
              flushPendingAssistant();
              onEntry(entry);
              if (entry.type === 'system' && hasSeenAssistant && !systemMarkerSeen) {
                const subtype = typeof entry.subtype === 'string' ? entry.subtype : undefined;
                if (subtype && TURN_END_SYSTEM_SUBTYPES.has(subtype)) {
                  systemMarkerSeen = true;
                  eventLogger.info('claudeIO', 'watcher: system marker observed (post-assistant)', {
                    threadId,
                    elapsedMs: Date.now() - tailStart,
                    subtype,
                  });
                } else {
                  eventLogger.info('claudeIO', 'watcher: system entry ignored (not turn-end subtype)', {
                    threadId,
                    elapsedMs: Date.now() - tailStart,
                    subtype: subtype ?? '<none>',
                  });
                }
              }
              // Resolve tool_results against the pending set. Tallied here, logged once at
              // settle as `toolResultsResolved` to avoid per-tool log spam.
              if (entry.type === 'user') {
                for (const block of userContent(entry)) {
                  if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                    if (pendingToolUseIds.delete(block.tool_use_id)) toolResultsResolved += 1;
                  }
                }
              }
            }
          } catch {
            // incomplete or non-JSON line — skip
          }
        }
        resetSilence();
      };

      this.cancelFn = () => settle(new Error('JSONL watcher cancelled'));

      if (timeoutMs && timeoutMs > 0) {
        timeoutTimer = setTimeout(
          () => settle(new Error(`Turn timed out after ${timeoutMs}ms (thread ${threadId})`)),
          timeoutMs
        );
      }

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

      resetSilence();
    });
  }
}
