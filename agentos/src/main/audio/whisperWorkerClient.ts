// Main-side client for the whisper utilityProcess. Owns the spawn lifecycle and
// the request/response correlation table. audioService forwards transcription
// calls here. Because whisper.node has no abort primitive, a per-call timeout
// kills the child outright (reclaiming the wedged native thread) and the next
// call respawns a fresh worker.

import path from 'path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { broadcastToWindows } from '../sessions/broadcaster';
import { eventLogger } from '../utils/eventLog';
import { IPC_EVENTS } from '../../shared/types/ipc';
import { WhisperWorkerCrashedError, type WhisperMessage, type WhisperRequest } from './worker/whisperIpc';

const LOG = 'voice-flow';

// Generous per-call ceiling: a healthy transcription of a 5-minute capture
// chunk runs in seconds (whisper is far faster than real time). Anything
// approaching minutes means the job has wedged — kill the child to reclaim it,
// staying under the renderer's 300s timeout so main recovers first.
const DEFAULT_CALL_TIMEOUT_MS = 240_000;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

let counter = 0;
function nextId(): string {
  counter = (counter + 1) >>> 0;
  return `w${Date.now().toString(36)}_${counter.toString(36)}`;
}

class WhisperWorkerClient {
  private child: UtilityProcess | null = null;
  private ready = false;
  private startingPromise: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private userDataPath: string | null = null;
  private shuttingDown = false;

  configure(userDataPath: string): void {
    this.userDataPath = userDataPath;
  }

  private resolveEntry(): string {
    // Bundled next to the main entry — __dirname is the bundle location, not the
    // source tree. Matches how the memory indexer resolves its worker.
    return path.join(__dirname, 'whisperWorker.js');
  }

  private async ensureStarted(): Promise<void> {
    if (!this.userDataPath) throw new Error('Whisper worker not configured — call configure() first.');
    if (this.ready) return;
    if (this.startingPromise) return this.startingPromise;
    this.startingPromise = this.spawn().finally(() => {
      this.startingPromise = null;
    });
    return this.startingPromise;
  }

  private async spawn(): Promise<void> {
    const child = utilityProcess.fork(this.resolveEntry(), [], {
      serviceName: 'agentos-whisper-worker',
      stdio: 'inherit',
    });
    this.child = child;
    this.ready = false;

    const readyPromise = new Promise<void>((resolve, reject) => {
      const onReady = (msg: WhisperMessage): void => {
        if (!msg || typeof msg !== 'object') return;
        if ((msg as { kind?: string }).kind === 'ready') {
          child.off('message', onReady);
          resolve();
        }
      };
      child.on('message', onReady);
      child.once('exit', (code) =>
        reject(new WhisperWorkerCrashedError(`Whisper worker exited before ready (code=${code})`))
      );
    });

    child.on('message', (msg: WhisperMessage) => this.onMessage(msg));
    child.on('exit', (code) => this.onExit(code));

    await readyPromise;
    await this.invoke('__init__', { userDataPath: this.userDataPath }, 30_000);
    this.ready = true;
  }

  private invoke<T>(method: string, args: unknown, timeoutMs: number): Promise<T> {
    const id = nextId();
    const req: WhisperRequest = { kind: 'request', id, method, args };
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.has(id)) return;
              this.pending.delete(id);
              eventLogger.warn(LOG, 'Transcription timed out — killing whisper worker', { method, timeoutMs });
              // whisper.node cannot abort an in-flight job, so kill the child to
              // reclaim the native thread. onExit rejects any other pending calls.
              this.killChild();
              reject(new WhisperWorkerCrashedError(`Whisper worker call timed out after ${timeoutMs}ms (${method})`));
            }, timeoutMs)
          : null;
      timer?.unref?.();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.child!.postMessage(req);
      } catch (err) {
        const entry = this.pending.get(id);
        if (entry?.timer) clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private onMessage(msg: WhisperMessage): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'response') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.kind === 'event') this.handleEvent(msg.channel, msg.payload);
  }

  private handleEvent(channel: string, payload: unknown): void {
    if (channel === 'whisper:log') {
      const p = payload as { level: 'info' | 'warn' | 'error'; message: string; meta?: Record<string, unknown> };
      eventLogger[p.level](LOG, p.message, p.meta);
      return;
    }
    // Download progress + transcript segments — forward to the renderer.
    if (channel === IPC_EVENTS.VOICE_FLOW_DOWNLOAD_PROGRESS || channel === IPC_EVENTS.VOICE_FLOW_TRANSCRIPT_SEGMENT) {
      broadcastToWindows(channel, payload);
    }
  }

  private killChild(): void {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      /* already dead — onExit will clean up */
    }
  }

  private onExit(code: number | null): void {
    this.ready = false;
    this.child = null;
    if (!this.shuttingDown) eventLogger.warn(LOG, 'Whisper worker exited', { code });
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new WhisperWorkerCrashedError(`Whisper worker exited (code=${code})`));
    }
    this.pending.clear();
  }

  async transcribeBuffer(audio: ArrayBuffer, model: string, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<string> {
    if (this.shuttingDown) throw new WhisperWorkerCrashedError('Whisper worker is shutting down');
    await this.ensureStarted();
    const { text } = await this.invoke<{ text: string }>('transcribeBuffer', { audio, model }, timeoutMs);
    return text;
  }

  async transcribeFromFile(filePath: string, model: string, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<string> {
    if (this.shuttingDown) throw new WhisperWorkerCrashedError('Whisper worker is shutting down');
    await this.ensureStarted();
    const { text } = await this.invoke<{ text: string }>('transcribeFromFile', { filePath, model }, timeoutMs);
    return text;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.killChild();
    this.child = null;
    this.ready = false;
  }
}

export const whisperWorkerClient = new WhisperWorkerClient();
