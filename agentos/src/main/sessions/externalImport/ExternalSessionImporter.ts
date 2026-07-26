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
  /** Inject /save-session-chunk on the adopted thread so its work lands in memory. */
  distill: (threadId: string) => Promise<void>;
  /** Subscribe to turn starts so a thread the user takes over stops being mirrored. Returns unsubscribe. */
  onTurnStarted: (handler: (threadId: string) => void) => () => void;
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
  private started = false;

  // sessionIds currently being adopted (in-flight, before claudeSessionId is persisted).
  private readonly adopting = new Set<string>();
  // threadId → stop function for an active mirror tail.
  private readonly mirrors = new Map<string, () => void>();

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
    for (const stop of Array.from(this.mirrors.values())) stop();
    this.mirrors.clear();
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

  /** Scan disk and adopt any unknown session touched within maxAgeMs. Idempotent. */
  private async reconcile(maxAgeMs: number): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const now = Date.now();
    const known = this.deps.listKnownClaudeSessionIds();
    const candidates = scanExternalSessions(this.deps.claudeDataDir)
      .filter((s) => now - s.mtimeMs <= maxAgeMs)
      .filter((s) => !known.has(s.sessionId) && !this.adopting.has(s.sessionId))
      .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first, so the newest thread is most-recently-active

    for (const info of candidates) {
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

    const emitter = new TranscriptMessageEmitter({
      appendUserMessage: (t) => this.deps.appendImportedMessage(thread.id, 'user', t, `${t}\n`),
      appendAssistantRaw: (raw) => this.deps.appendImportedMessage(thread.id, 'assistant', raw, raw),
    });
    for (const entry of entries) emitter.push(entry);

    // Tail from the snapshot's end. For an idle (already-finished) session this settles after
    // MIRROR_IDLE_MS and distills; for a still-active terminal session it live-mirrors until idle.
    this.startMirror(thread.id, info.jsonlPath, Buffer.byteLength(text, 'utf8'), emitter);
  }

  private startMirror(threadId: string, jsonlPath: string, startPos: number, emitter: TranscriptMessageEmitter): void {
    let pos = startPos;
    let tail = '';
    let idleTimer: NodeJS.Timeout | null = null;

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
      armIdle();
    };

    const onChange = (curr: fs.Stats): void => handleNewBytes(curr.size);

    this.mirrors.set(threadId, () => stop(false));
    fs.watchFile(jsonlPath, { interval: MIRROR_POLL_MS, persistent: false }, onChange);
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
