import fs from 'fs';
import path from 'path';
import { eventLogger } from '../../utils/eventLog';
import { getErrorMessage } from '../../../shared/utils/errorMessage';
import type { CreateThreadRequest, Thread } from '../../../shared/types';
import type { JsonlEntry } from '../claudeInteractive/ClaudeJsonlWatcher';
import { generateSlugFromSessionId } from '../messagePersistence';
import { scanExternalSessions, type ExternalSessionInfo } from './transcriptScanner';
import { parseTranscriptLines, transcriptHasAssistant, TranscriptMessageEmitter } from './transcriptReader';

export interface ExternalSessionImporterDeps {
  claudeDataDir: string;
  /** Feature master switch — re-read on every scan so a settings toggle takes effect live. */
  isEnabled: () => boolean;
  /** claudeSessionIds AgentOS already owns; used to skip sessions it launched or already adopted. */
  listKnownClaudeSessionIds: () => Set<string>;
  /**
   * Map an external cwd to the AgentOS project root to scope the adopted thread (and its memory)
   * under. Returns null when the cwd is not inside any project AgentOS knows — those are skipped
   * so importing never spawns junk projects for arbitrary directories.
   */
  matchProjectPath: (cwd: string) => string | null;
  createThread: (req: CreateThreadRequest) => Promise<Thread>;
  bindClaudeSession: (threadId: string, sessionId: string) => void;
  appendImportedMessage: (threadId: string, role: 'user' | 'assistant', text: string, raw: string) => void;
  /** Persist how many transcript bytes have been ingested for a thread (drives live re-ingestion). */
  setImportOffset: (threadId: string, offset: number) => void;
  /**
   * The adopted thread + ingested offset for an already-imported session, or null when no thread
   * owns this session as an import (native in-app claude-interactive threads never carry an offset).
   */
  getImportState: (sessionId: string) => { threadId: string; offset: number } | null;
  /** True while the thread is running an in-app turn — its own pipeline owns transcript writes then. */
  isThreadRunning: (threadId: string) => boolean;
  /** Inject /save-session-chunk on the adopted thread so its work lands in memory. */
  distill: (threadId: string) => Promise<void>;
  /** Subscribe to turn starts so a thread the user takes over stops being mirrored. Returns unsubscribe. */
  onTurnStarted: (handler: (threadId: string) => void) => () => void;
  /** Subscribe to turn ends so AgentOS-written transcript bytes are marked ingested. Returns unsubscribe. */
  onTurnEnded: (handler: (threadId: string) => void) => () => void;
}

const RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // startup: only sessions touched in the last 24h
const LIVE_MAX_AGE_MS = 10 * 60 * 1000; // live watch: a session touched in the last 10 min is a candidate
const WATCH_DEBOUNCE_MS = 2_000;
const MIRROR_IDLE_MS = 15_000; // no writes for this long → the external turn is done; settle + distill
const MIRROR_POLL_MS = 500;
const DISTILL_SPACING_MS = 3_000; // stagger distills so reconciling many sessions doesn't spawn N at once

export class ExternalSessionImporter {
  private watcher: fs.FSWatcher | null = null;
  private watchDebounce: NodeJS.Timeout | null = null;
  private unsubscribeTurns: (() => void) | null = null;
  private unsubscribeTurnsEnded: (() => void) | null = null;
  private started = false;

  // sessionIds currently being adopted (in-flight, before claudeSessionId is persisted).
  private readonly adopting = new Set<string>();
  // threadId → stop function for an active mirror tail.
  private readonly mirrors = new Map<string, () => void>();
  // threadId → transcript path, for imported threads (so a turn:ended can re-stat the file).
  private readonly importedPaths = new Map<string, string>();

  private readonly distillQueue: string[] = [];
  private distillPumping = false;

  constructor(private readonly deps: ExternalSessionImporterDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.deps.isEnabled()) {
      eventLogger.info('import', 'External session import disabled — not starting');
      return;
    }
    // When the user takes over an adopted thread with an in-app turn, stop mirroring it — the live
    // turn renders new output and its own idle-stop runs /save-session-chunk via SessionChunkManager.
    this.unsubscribeTurns = this.deps.onTurnStarted((threadId) => this.stopMirror(threadId));
    // When an in-app turn ends on an imported thread (a distill or a user takeover), the transcript
    // now holds AgentOS-written bytes. Advance the ingested offset past them so re-ingestion only
    // ever picks up *future external* appends — this is what breaks the distill feedback loop.
    this.unsubscribeTurnsEnded = this.deps.onTurnEnded((threadId) => this.markAgentWritesIngested(threadId));
    // One-time reconcile of recent sessions, then keep watching for new ones.
    void this.reconcile(RECONCILE_MAX_AGE_MS);
    this.startWatching();
  }

  dispose(): void {
    this.started = false;
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = null;
    try {
      this.watcher?.close();
    } catch {
      // best-effort
    }
    this.watcher = null;
    this.unsubscribeTurns?.();
    this.unsubscribeTurns = null;
    this.unsubscribeTurnsEnded?.();
    this.unsubscribeTurnsEnded = null;
    for (const stop of Array.from(this.mirrors.values())) stop();
    this.mirrors.clear();
    this.importedPaths.clear();
  }

  private startWatching(): void {
    const projectsDir = path.join(this.deps.claudeDataDir, 'projects');
    try {
      fs.mkdirSync(projectsDir, { recursive: true });
      // Recursive watch: new sessions appear as projects/<slug>/<sessionId>.jsonl. Rather than
      // interpret each event, debounce and re-scan for recently-touched unknown sessions.
      this.watcher = fs.watch(projectsDir, { recursive: true }, () => {
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => {
          void this.reconcile(LIVE_MAX_AGE_MS);
        }, WATCH_DEBOUNCE_MS);
      });
      eventLogger.info('import', 'Watching for external Claude sessions', { projectsDir });
    } catch (err) {
      eventLogger.warn('import', 'Failed to watch ~/.claude/projects', { error: getErrorMessage(err) });
    }
  }

  /**
   * Scan disk and (a) adopt any unknown session touched within maxAgeMs, then (b) re-ingest the
   * delta of any already-imported session whose transcript grew since we last read it. Idempotent.
   */
  private async reconcile(maxAgeMs: number): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const now = Date.now();
    const recent = scanExternalSessions(this.deps.claudeDataDir)
      .filter((s) => now - s.mtimeMs <= maxAgeMs)
      .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first, so the newest thread is most-recently-active

    const known = this.deps.listKnownClaudeSessionIds();
    for (const info of recent) {
      if (known.has(info.sessionId) || this.adopting.has(info.sessionId)) continue;
      // Re-check per-item: AgentOS may have claimed this ID after the scan snapshot (for
      // example, while a new in-app Claude turn was launching).
      if (this.deps.listKnownClaudeSessionIds().has(info.sessionId) || this.adopting.has(info.sessionId)) continue;
      this.adopting.add(info.sessionId);
      try {
        await this.adopt(info);
      } catch (err) {
        eventLogger.warn('import', 'Failed to adopt external session', {
          sessionId: info.sessionId,
          error: getErrorMessage(err),
        });
      } finally {
        this.adopting.delete(info.sessionId);
      }
    }

    for (const info of recent) this.reingestIfGrown(info);
  }

  /**
   * Re-attach the live mirror to an already-imported session whose transcript has grown beyond the
   * bytes we last ingested — importing only the appended delta. Skips sessions that aren't imports,
   * are already mirroring, or are being driven by an in-app turn (that turn's own pipeline handles
   * its writes; markAgentWritesIngested advances the offset once it ends).
   */
  private reingestIfGrown(info: ExternalSessionInfo): void {
    const state = this.deps.getImportState(info.sessionId);
    if (!state) return;
    // Remember the path even if we don't re-ingest now, so a later turn:ended on this thread can
    // advance the offset past AgentOS-written bytes (matters right after a restart, before any mirror).
    this.importedPaths.set(state.threadId, info.jsonlPath);
    if (this.mirrors.has(state.threadId)) return;
    if (this.deps.isThreadRunning(state.threadId)) return;
    if (info.size <= state.offset) return;
    this.startMirror(state.threadId, info.jsonlPath, state.offset, this.makeEmitter(state.threadId));
    eventLogger.info('import', 'Re-ingesting external session delta', {
      threadId: state.threadId,
      sessionId: info.sessionId,
      from: state.offset,
      to: info.size,
    });
  }

  /** Build a fresh emitter that appends reconstructed messages to a thread. */
  private makeEmitter(threadId: string): TranscriptMessageEmitter {
    return new TranscriptMessageEmitter({
      appendUserMessage: (t) => this.deps.appendImportedMessage(threadId, 'user', t, `${t}\n`),
      appendAssistantRaw: (raw) => this.deps.appendImportedMessage(threadId, 'assistant', raw, raw),
    });
  }

  /**
   * An in-app turn just ended on an imported thread — its own messages were appended to the same
   * transcript by AgentOS. Mark the whole file as ingested so re-ingestion won't re-import those
   * bytes (which would duplicate them and, for /save-session-chunk, loop forever).
   */
  private markAgentWritesIngested(threadId: string): void {
    const jsonlPath = this.importedPaths.get(threadId);
    if (!jsonlPath) return;
    try {
      this.deps.setImportOffset(threadId, fs.statSync(jsonlPath).size);
    } catch {
      // best-effort — transcript may have been removed
    }
  }

  private async adopt(info: ExternalSessionInfo): Promise<void> {
    if (!info.cwd) {
      eventLogger.debug('import', 'Skipping session with no discoverable cwd', { sessionId: info.sessionId });
      return;
    }
    const projectPath = this.deps.matchProjectPath(info.cwd);
    if (!projectPath) {
      eventLogger.debug('import', 'Skipping session outside known projects', {
        sessionId: info.sessionId,
        cwd: info.cwd,
      });
      return;
    }

    let text: string;
    try {
      text = fs.readFileSync(info.jsonlPath, 'utf8');
    } catch (err) {
      eventLogger.warn('import', 'Failed to read transcript', {
        sessionId: info.sessionId,
        error: getErrorMessage(err),
      });
      return;
    }
    const entries = parseTranscriptLines(text);
    if (!transcriptHasAssistant(entries)) return; // nothing worth importing yet

    const thread = await this.deps.createThread({
      name: generateSlugFromSessionId(info.sessionId),
      workingDirectory: info.cwd,
      projectPath,
      provider: 'claude-interactive',
      runOnHost: true,
      createWorktree: false,
    });
    this.deps.bindClaudeSession(thread.id, info.sessionId);
    eventLogger.info('import', 'Adopted external Claude session', {
      threadId: thread.id,
      sessionId: info.sessionId,
      cwd: info.cwd,
    });

    const emitter = this.makeEmitter(thread.id);
    for (const entry of entries) emitter.push(entry);

    // Mark the snapshot as ingested up front so a crash mid-mirror re-ingests only the delta on the
    // next run rather than re-importing the whole file.
    const startPos = Buffer.byteLength(text, 'utf8');
    this.importedPaths.set(thread.id, info.jsonlPath);
    this.deps.setImportOffset(thread.id, startPos);

    // Tail from the snapshot's end. For an idle (already-finished) session this settles after
    // MIRROR_IDLE_MS and distills; for a still-active terminal session it live-mirrors until idle.
    this.startMirror(thread.id, info.jsonlPath, startPos, emitter);
  }

  private startMirror(threadId: string, jsonlPath: string, startPos: number, emitter: TranscriptMessageEmitter): void {
    let pos = startPos;
    let tail = '';
    let idleTimer: NodeJS.Timeout | null = null;
    // Byte offset of the end of the last complete line consumed (pos minus the retained partial
    // line). This is the resume point: re-reading from here re-reads that partial line in full.
    const committed = (): number => pos - Buffer.byteLength(tail, 'utf8');

    const stop = (distill: boolean): void => {
      if (!this.mirrors.has(threadId)) return;
      this.mirrors.delete(threadId);
      if (idleTimer) clearTimeout(idleTimer);
      try {
        fs.unwatchFile(jsonlPath, onChange);
      } catch {
        // best-effort
      }
      emitter.flush();
      this.deps.setImportOffset(threadId, committed());
      if (distill) this.enqueueDistill(threadId);
    };

    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop(true), MIRROR_IDLE_MS);
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
        if (!trimmed.startsWith('{')) continue;
        let entry: JsonlEntry;
        try {
          entry = JSON.parse(trimmed) as JsonlEntry;
        } catch {
          continue;
        }
        emitter.push(entry);
      }
      // Persist the newline-aligned offset so a restart (or re-ingest) resumes exactly here.
      this.deps.setImportOffset(threadId, committed());
      armIdle();
    };

    const onChange = (curr: fs.Stats): void => handleNewBytes(curr.size);

    this.mirrors.set(threadId, () => stop(false));
    fs.watchFile(jsonlPath, { interval: MIRROR_POLL_MS, persistent: false }, onChange);
    // Catch up on bytes already present beyond startPos before waiting on change events — this is the
    // re-ingest delta of an already-idle session (and closes any adopt-time read/stat race).
    try {
      handleNewBytes(fs.statSync(jsonlPath).size);
    } catch {
      // best-effort
    }
    armIdle();
  }

  private stopMirror(threadId: string): void {
    this.mirrors.get(threadId)?.();
  }

  private enqueueDistill(threadId: string): void {
    if (this.distillQueue.includes(threadId)) return;
    this.distillQueue.push(threadId);
    void this.pumpDistill();
  }

  private async pumpDistill(): Promise<void> {
    if (this.distillPumping) return;
    this.distillPumping = true;
    try {
      while (this.distillQueue.length > 0) {
        const threadId = this.distillQueue.shift()!;
        try {
          await this.deps.distill(threadId);
        } catch (err) {
          eventLogger.warn('import', 'Distill on imported session failed', {
            threadId,
            error: getErrorMessage(err),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, DISTILL_SPACING_MS));
      }
    } finally {
      this.distillPumping = false;
    }
  }
}
