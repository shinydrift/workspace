// Whisper transcription utility process.
//
// Owns the native @fugood/whisper.node context. The main process talks to this
// via the IPC envelope in ./whisperIpc.ts. Running here keeps whisper's
// AsyncWorker jobs off the Electron main process's libuv thread pool, so a slow
// or wedged transcription can never starve fs/dns/crypto and freeze the app.

import { WhisperEngine } from './whisperEngine';
import { IPC_EVENTS } from '../../../shared/types/ipc';
import type { WhisperMessage, WhisperOutbound, WhisperRequest } from './whisperIpc';

interface ParentPortLike {
  postMessage: (msg: WhisperOutbound) => void;
  on: (event: 'message', listener: (event: { data: WhisperMessage }) => void) => void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  console.error('[whisper-worker] missing parentPort — must be spawned via utilityProcess.fork');
  process.exit(1);
}

function send(msg: WhisperOutbound): void {
  parentPort!.postMessage(msg);
}

function emitLog(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  send({ kind: 'event', channel: 'whisper:log', payload: { level, message, meta } });
}

let engine: WhisperEngine | null = null;

// Serialize transcription: the single WhisperContext is stateful and cannot run
// concurrent jobs. Chain requests so a burst (continuous capture + meeting
// recorder + Slack) runs sequentially inside this isolated process.
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  // Advance the chain, swallowing errors so one failed job doesn't poison the queue.
  chain = run.catch((): void => {});
  return run;
}

async function handleRequest(req: WhisperRequest): Promise<void> {
  const respond = (result: unknown): void => send({ kind: 'response', id: req.id, result });
  const fail = (err: unknown): void =>
    send({ kind: 'response', id: req.id, error: { message: err instanceof Error ? err.message : String(err) } });

  try {
    if (req.method === '__init__') {
      const { userDataPath } = req.args as { userDataPath: string };
      engine = new WhisperEngine(userDataPath, {
        onDownloadProgress: (model, percent) =>
          send({ kind: 'event', channel: IPC_EVENTS.VOICE_FLOW_DOWNLOAD_PROGRESS, payload: { model, percent } }),
        onSegment: (text) =>
          send({ kind: 'event', channel: IPC_EVENTS.VOICE_FLOW_TRANSCRIPT_SEGMENT, payload: { text } }),
        onLog: emitLog,
      });
      respond(null);
      return;
    }
    if (!engine) throw new Error('Whisper worker not initialized (init request missing).');

    if (req.method === 'transcribeBuffer') {
      const { audio, model } = req.args as { audio: ArrayBuffer; model: string };
      const text = await enqueue(() => engine!.transcribeBuffer(Buffer.from(audio), model));
      respond({ text });
      return;
    }
    if (req.method === 'transcribeFromFile') {
      const { filePath, model } = req.args as { filePath: string; model: string };
      const text = await enqueue(() => engine!.transcribeFromFile(filePath, model));
      respond({ text });
      return;
    }
    throw new Error(`Unknown whisper worker method: ${req.method}`);
  } catch (err) {
    fail(err);
  }
}

parentPort.on('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object' || msg.kind !== 'request') return;
  void handleRequest(msg);
});

send({ kind: 'ready', ok: true });
