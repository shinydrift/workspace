// IPC envelope shared by the main-side whisperWorkerClient and the whisper
// utilityProcess. Mirrors the memory indexer's envelope (../../memory/worker/ipc.ts).
//   - Request:  main → worker. Correlation id matches Response.
//   - Response: worker → main. Settles the awaiting promise.
//   - Event:    worker → main. Download progress, transcript segments, logs.
//   - Ready:    worker → main. Sent once the native module has loaded.

export type WhisperRequest = {
  kind: 'request';
  id: string;
  method: string;
  args: unknown;
};

export type WhisperResponse = {
  kind: 'response';
  id: string;
  result?: unknown;
  error?: { message: string };
};

export type WhisperEvent = {
  kind: 'event';
  channel: string;
  payload: unknown;
};

export type WhisperReady = {
  kind: 'ready';
  // Whether initWhisper's native module loaded. Errors surface at spawn time
  // rather than at first transcribe.
  ok: boolean;
  error?: string;
};

export type WhisperMessage = WhisperRequest | WhisperResponse | WhisperEvent;
export type WhisperOutbound = WhisperResponse | WhisperEvent | WhisperReady;

export class WhisperWorkerCrashedError extends Error {
  constructor(message = 'Whisper worker crashed') {
    super(message);
    this.name = 'WhisperWorkerCrashedError';
  }
}
