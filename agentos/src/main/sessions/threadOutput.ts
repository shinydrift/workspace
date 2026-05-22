import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import type { ThreadLogEntry, MessageRole, MessageNormalizedPayload, Message } from '../../shared/types';
import { MCP_MEMORY_GET_TOOL } from '../../shared/types';
import { getStore } from '../store/index';
import * as threadStore from '../threads/threadStore';
import { broadcastMessageAppended, broadcastTerminalData } from './broadcaster';
import { normalizeMessages, normalizeMessagesMultiTurn } from '../normalizers';
import stripAnsiHelper from 'strip-ansi';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { emitTokenUsage } from '../events';
import { analyticsService } from '../analytics/service';
import { updateProviderRateLimits } from '../analytics/providerRateLimitsStore';
import { refreshProviderRateLimits } from '../analytics/providerRateLimitRefresh';

/**
 * Manages all output buffering and message persistence for threads.
 * Owns: logBuffers, logStreams, pendingAssistantChunks, and the dirs they write to.
 */
const LOG_FILE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB hard cap per thread log file

// The containerized claude-code CLI prints warnings about /home/agent/.claude.json
// (missing / corrupted / backup paths) because we intentionally don't mount that
// file. The messages are harmless but noisy — drop them before they reach the
// thread log, terminal broadcast, or assistant chunk buffer.
const CLAUDE_CONFIG_NOISE_RE =
  /(Configuration error in \/home\/agent\/\.claude\.json|Claude configuration file (?:at \/home\/agent\/\.claude\.json is corrupted|not found)|corrupted file has already been backed up|A backup file exists at:|You can manually restore it by running)/;

export function filterClaudeCliNoise(data: string): string {
  if (!CLAUDE_CONFIG_NOISE_RE.test(data)) return data;
  return data
    .split('\n')
    .filter((line) => !CLAUDE_CONFIG_NOISE_RE.test(line))
    .join('\n');
}

export class ThreadOutputManager {
  private logBuffers = new Map<string, ThreadLogEntry[]>();
  private logStreams = new Map<string, fs.WriteStream>();
  private logStreamBytesWritten = new Map<string, number>();
  private pendingAssistantChunks = new Map<string, string[]>();
  private firstChunkTimestamps = new Map<string, number>();
  private logsDir = '';
  private messagesDir = '';

  setDirs(logsDir: string, messagesDir: string): void {
    this.logsDir = logsDir;
    this.messagesDir = messagesDir;
  }

  /** Initialize an empty log buffer for a new/loaded thread. */
  initLogBuffer(threadId: string): void {
    this.logBuffers.set(threadId, []);
  }

  /** Pre-populate log buffer from disk (called at startup). */
  preloadFromDisk(threadIds: string[]): void {
    const PRELOAD_BYTES = 512 * 1024;
    for (const id of threadIds) {
      const logPath = path.join(this.logsDir, `${id}.log`);
      if (!fs.existsSync(logPath)) {
        this.logBuffers.set(id, []);
        continue;
      }
      try {
        const stat = fs.statSync(logPath);
        const start = Math.max(0, stat.size - PRELOAD_BYTES);
        const fd = fs.openSync(logPath, 'r');
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        const raw = buf.toString('utf8');
        const entries: ThreadLogEntry[] = [];
        for (let i = 0; i < raw.length; i += 4096) {
          entries.push({ id: nanoid(), timestamp: 0, data: raw.slice(i, i + 4096), source: 'stdout' });
        }
        this.logBuffers.set(id, entries);
      } catch {
        this.logBuffers.set(id, []);
      }
    }
  }

  /** Async version of preloadFromDisk — used in the deferred late-load phase. Skips threads that already have output. */
  async preloadFromDiskAsync(threadIds: string[]): Promise<void> {
    const PRELOAD_BYTES = 512 * 1024;
    await Promise.all(
      threadIds.map(async (id) => {
        // Skip if the buffer has already been written to (thread started before late-load ran).
        if ((this.logBuffers.get(id)?.length ?? 0) > 0) return;
        const logPath = path.join(this.logsDir, `${id}.log`);
        try {
          const stat = await fs.promises.stat(logPath);
          const start = Math.max(0, stat.size - PRELOAD_BYTES);
          const size = stat.size - start;
          const buf = Buffer.alloc(size);
          const fh = await fs.promises.open(logPath, 'r');
          try {
            await fh.read(buf, 0, size, start);
          } finally {
            await fh.close();
          }
          const raw = buf.toString('utf8');
          const entries: ThreadLogEntry[] = [];
          for (let i = 0; i < raw.length; i += 4096) {
            entries.push({ id: nanoid(), timestamp: 0, data: raw.slice(i, i + 4096), source: 'stdout' });
          }
          this.logBuffers.set(id, entries);
        } catch {
          this.logBuffers.set(id, []);
        }
      })
    );
  }

  /** Open an append-mode log stream for the thread. Skipped if file is already at the size cap. */
  openLogStream(threadId: string): void {
    const logPath = path.join(this.logsDir, `${threadId}.log`);
    let existingSize = 0;
    try {
      existingSize = fs.statSync(logPath).size;
    } catch {
      /* new file */
    }
    if (existingSize >= LOG_FILE_MAX_BYTES) return; // already at cap — drop further writes
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    this.logStreams.set(threadId, logStream);
    this.logStreamBytesWritten.set(threadId, existingSize);
  }

  /** Close and remove the log stream for the thread. */
  closeLogStream(threadId: string): void {
    const stream = this.logStreams.get(threadId);
    if (stream) {
      stream.end();
      this.logStreams.delete(threadId);
      this.logStreamBytesWritten.delete(threadId);
    }
  }

  /** Remove all in-memory state for a thread (call on delete/archive). */
  cleanupThread(threadId: string): void {
    this.logBuffers.delete(threadId);
    this.pendingAssistantChunks.delete(threadId);
    this.firstChunkTimestamps.delete(threadId);
    this.logStreamBytesWritten.delete(threadId);
  }

  getLogHistory(threadId: string): ThreadLogEntry[] {
    return this.logBuffers.get(threadId) ?? [];
  }

  appendLog(threadId: string, data: string): void {
    const maxLogBuffer = getStore().get('settings').maxLogBufferSize ?? 2000;
    const buf = this.logBuffers.get(threadId) ?? [];
    buf.push({ id: nanoid(), timestamp: Date.now(), data, source: 'stdout' });
    if (buf.length > maxLogBuffer) buf.shift();
    this.logBuffers.set(threadId, buf);
    const stream = this.logStreams.get(threadId);
    if (stream) {
      stream.write(data);
      const bytes = (this.logStreamBytesWritten.get(threadId) ?? 0) + Buffer.byteLength(data, 'utf8');
      this.logStreamBytesWritten.set(threadId, bytes);
      if (bytes >= LOG_FILE_MAX_BYTES) this.closeLogStream(threadId);
    }
    const chunks = this.pendingAssistantChunks.get(threadId) ?? [];
    if (chunks.length === 0 && !this.firstChunkTimestamps.has(threadId)) {
      this.firstChunkTimestamps.set(threadId, Date.now());
    }
    chunks.push(data);
    this.pendingAssistantChunks.set(threadId, chunks);
  }

  appendSystemLogEntry(threadId: string, data: string): void {
    const maxLogBuffer = getStore().get('settings').maxLogBufferSize ?? 2000;
    const buf = this.logBuffers.get(threadId) ?? [];
    const entry = data.endsWith('\r\n') ? data : `${data}\r\n`;
    buf.push({ id: nanoid(), timestamp: Date.now(), data: entry, source: 'system' });
    if (buf.length > maxLogBuffer) buf.shift();
    this.logBuffers.set(threadId, buf);
    const sysStream = this.logStreams.get(threadId);
    if (sysStream) {
      sysStream.write(entry);
      const bytes = (this.logStreamBytesWritten.get(threadId) ?? 0) + Buffer.byteLength(entry, 'utf8');
      this.logStreamBytesWritten.set(threadId, bytes);
      if (bytes >= LOG_FILE_MAX_BYTES) this.closeLogStream(threadId);
    }
    broadcastTerminalData({ threadId, data: entry });
  }

  getPendingOutput(threadId: string): string {
    return (this.pendingAssistantChunks.get(threadId) ?? []).join('');
  }

  clearPendingOutput(threadId: string): void {
    this.pendingAssistantChunks.set(threadId, []);
    this.firstChunkTimestamps.delete(threadId);
  }

  getRecentThreadOutput(threadId: string): string {
    const history = this.logBuffers.get(threadId) ?? [];
    return history
      .slice(-20)
      .map((entry) => entry.data)
      .join('');
  }

  flushAssistantMessage(threadId: string, opts?: { multiTurn?: boolean; skipSideEffects?: boolean }): void {
    const chunks = this.pendingAssistantChunks.get(threadId);
    if (!chunks || chunks.length === 0) return;
    this.pendingAssistantChunks.set(threadId, []);
    const firstChunkAt = this.firstChunkTimestamps.get(threadId);
    this.firstChunkTimestamps.delete(threadId);
    const raw = chunks.join('');
    const cleaned = stripAnsiHelper(raw).trim();
    if (!cleaned) return;
    this.appendNormalizedMessageWithSource(threadId, 'assistant', undefined, cleaned, raw, firstChunkAt, {
      multiTurn: opts?.multiTurn ?? false,
      skipSideEffects: opts?.skipSideEffects,
    });
  }

  appendNormalizedMessage(
    threadId: string,
    role: MessageRole,
    text: string,
    raw?: string,
    firstChunkAt?: number
  ): void {
    this.appendNormalizedMessageWithSource(threadId, role, undefined, text, raw, firstChunkAt);
  }

  appendNormalizedMessageWithSource(
    threadId: string,
    role: MessageRole,
    source: Message['source'] | undefined,
    text: string,
    raw?: string,
    firstChunkAt?: number,
    opts?: { multiTurn?: boolean; skipSideEffects?: boolean }
  ): void {
    const thread = threadStore.getThread(threadId);
    const provider = thread?.provider ?? 'claude';
    const normalize = opts?.multiTurn ? normalizeMessagesMultiTurn : normalizeMessages;
    const results = normalize({ provider, role, text, raw });
    let tokenUsageEmitted = false;
    const toolUseIdToName = new Map<string, string>();
    const toolStats = new Map<string, { name: string; count: number; successCount: number; errorCount: number }>();
    let memoryGetCallCount = 0;
    let assistantResultCount = 0;
    for (const result of results) {
      if (role === 'assistant' && !result.content && result.normalized.blocks.length === 0) continue;
      this.appendMessage(
        threadId,
        role,
        result.content,
        result.normalized,
        source,
        role === 'assistant' ? firstChunkAt : undefined
      );
      if (!opts?.skipSideEffects) {
        // Emit token usage once per normalizeMessages call (first result that carries it).
        // Claude's message_start/message_delta events already carry cumulative totals for the
        // entire exchange, so emitting on the first result is correct and avoids double-counting.
        if (!tokenUsageEmitted && result.tokenUsage && thread?.projectId) {
          tokenUsageEmitted = true;
          emitTokenUsage({
            threadId,
            projectId: thread.projectId,
            provider,
            model: result.tokenUsage.model ?? thread?.model,
            inputTokens: result.tokenUsage.inputTokens,
            outputTokens: result.tokenUsage.outputTokens,
            cacheReadTokens: result.tokenUsage.cacheReadTokens,
            cacheCreationTokens: result.tokenUsage.cacheCreationTokens,
          });
        }
        if (result.rateLimitWindows) {
          updateProviderRateLimits(provider, result.rateLimitWindows);
        }
      }
      // Track turn/tool counts for assistant messages.
      if (role === 'assistant') {
        assistantResultCount++;
        for (const b of result.normalized.blocks) {
          if (b.type === 'tool_use') {
            toolUseIdToName.set(b.id, b.name);
            const existing = toolStats.get(b.name) ?? { name: b.name, count: 0, successCount: 0, errorCount: 0 };
            existing.count++;
            toolStats.set(b.name, existing);
            if (b.name === MCP_MEMORY_GET_TOOL) memoryGetCallCount++;
          } else if (b.type === 'tool_result') {
            const toolName = toolUseIdToName.get(b.toolUseId);
            if (!toolName) continue;
            const existing = toolStats.get(toolName);
            if (!existing) continue;
            if (b.isError) existing.errorCount++;
            else existing.successCount++;
          }
        }
      }
    }
    if (!opts?.skipSideEffects && role === 'assistant' && assistantResultCount > 0) {
      analyticsService.onAssistantMessage(threadId, assistantResultCount, [...toolStats.values()], memoryGetCallCount);
      refreshProviderRateLimits({ force: true }).catch((error: unknown) => {
        eventLogger.warn('thread', 'Provider rate limit refresh failed after assistant turn', {
          error: getErrorMessage(error),
        });
      });
    }
  }

  /**
   * Emit analytics, token usage, and rate-limit side effects for an interactive turn
   * without re-broadcasting messages. Called once after the turn completes so that
   * per-entry flushes (which skip side effects) are correctly aggregated.
   */
  flushSideEffectsOnly(threadId: string, rawOutput: string): void {
    const thread = threadStore.getThread(threadId);
    if (!thread?.projectId) return;
    const provider = thread.provider ?? 'claude';
    const cleaned = stripAnsiHelper(rawOutput).trim();
    if (!cleaned) return;
    const results = normalizeMessagesMultiTurn({ provider, role: 'assistant', text: cleaned });
    let tokenUsageEmitted = false;
    const toolUseIdToName = new Map<string, string>();
    const toolStats = new Map<string, { name: string; count: number; successCount: number; errorCount: number }>();
    let memoryGetCallCount = 0;
    let assistantResultCount = 0;
    for (const result of results) {
      if (result.normalized.blocks.length === 0) continue;
      assistantResultCount++;
      if (!tokenUsageEmitted && result.tokenUsage) {
        tokenUsageEmitted = true;
        emitTokenUsage({
          threadId,
          projectId: thread.projectId,
          provider,
          model: result.tokenUsage.model ?? thread.model,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          cacheReadTokens: result.tokenUsage.cacheReadTokens,
          cacheCreationTokens: result.tokenUsage.cacheCreationTokens,
        });
      }
      if (result.rateLimitWindows) {
        updateProviderRateLimits(provider, result.rateLimitWindows);
      }
      for (const b of result.normalized.blocks) {
        if (b.type === 'tool_use') {
          toolUseIdToName.set(b.id, b.name);
          const existing = toolStats.get(b.name) ?? { name: b.name, count: 0, successCount: 0, errorCount: 0 };
          existing.count++;
          toolStats.set(b.name, existing);
          if (b.name === MCP_MEMORY_GET_TOOL) memoryGetCallCount++;
        } else if (b.type === 'tool_result') {
          const toolName = toolUseIdToName.get(b.toolUseId);
          if (!toolName) continue;
          const existing = toolStats.get(toolName);
          if (!existing) continue;
          if (b.isError) existing.errorCount++;
          else existing.successCount++;
        }
      }
    }
    if (assistantResultCount > 0) {
      analyticsService.onAssistantMessage(threadId, assistantResultCount, [...toolStats.values()], memoryGetCallCount);
      refreshProviderRateLimits({ force: true }).catch((error: unknown) => {
        eventLogger.warn('thread', 'Provider rate limit refresh failed after interactive turn', {
          error: getErrorMessage(error),
        });
      });
    }
  }

  appendMessage(
    threadId: string,
    role: MessageRole,
    content: string,
    normalized?: MessageNormalizedPayload,
    source?: Message['source'],
    firstChunkAt?: number
  ): void {
    const msg: Message = {
      id: nanoid(),
      threadId,
      role,
      source,
      content,
      normalized,
      timestamp: Date.now(),
      firstChunkAt,
    };
    broadcastMessageAppended({ threadId, message: msg });
    try {
      fs.appendFileSync(path.join(this.messagesDir, `${threadId}.jsonl`), JSON.stringify(msg) + '\n');
    } catch (err) {
      eventLogger.error('thread', 'Failed to persist message', { threadId, role, error: getErrorMessage(err) });
    }
  }

  listMessages(threadId: string, opts?: { sinceMs?: number; role?: string }): Message[] {
    const p = path.join(this.messagesDir, `${threadId}.jsonl`);
    if (!fs.existsSync(p)) return [];
    try {
      let messages = fs
        .readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Message);
      if (opts?.sinceMs !== undefined) {
        const sinceMs = opts.sinceMs;
        messages = messages.filter((m) => m.timestamp >= sinceMs);
      }
      if (opts?.role !== undefined) {
        const role = opts.role;
        messages = messages.filter((m) => m.role === role);
      }
      return messages;
    } catch {
      return [];
    }
  }

  clearMessages(threadId: string): void {
    fs.unlink(path.join(this.messagesDir, `${threadId}.jsonl`), () => {});
  }

  /** Delete persisted log and message files (call on thread delete, not archive). */
  deleteThreadFiles(threadId: string): void {
    fs.unlink(path.join(this.logsDir, `${threadId}.log`), () => {});
    fs.unlink(path.join(this.messagesDir, `${threadId}.jsonl`), () => {});
  }
}
