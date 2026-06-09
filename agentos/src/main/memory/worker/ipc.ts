// IPC envelope shared by the main-side workerClient and the utilityProcess
// indexer. Three message kinds:
//   - Request:  main → worker. Correlation id matches Response.
//   - Response: worker → main. Settles the awaiting promise.
//   - Event:    worker → main. Broadcasts and log lines forwarded via runtime.

export type WorkerRequest = {
  kind: 'request';
  id: string;
  method: string;
  args: unknown;
};

export type WorkerResponse = {
  kind: 'response';
  id: string;
  result?: unknown;
  error?: { message: string; code?: string };
};

export type WorkerEvent = {
  kind: 'event';
  channel: string;
  payload: unknown;
};

export type WorkerMessage = WorkerRequest | WorkerResponse | WorkerEvent;

// Sent by the worker after it has installed its runtime and is ready to accept
// method calls. The probe field reports whether the native modules required by
// 4b (better-sqlite3, sqlite-vec, node-llama-cpp) loaded successfully in the
// utilityProcess context — surfaced in the ready handshake so a 4b regression
// shows up at spawn time, not at first DB write.
export type WorkerReady = {
  kind: 'ready';
  probe: {
    betterSqlite3: boolean;
    sqliteVec: boolean;
    nodeLlamaCpp: boolean;
    errors: string[];
  };
};

export type WorkerOutbound = WorkerResponse | WorkerEvent | WorkerReady;

export class MemoryIndexerCrashedError extends Error {
  constructor(message = 'Memory indexer crashed') {
    super(message);
    this.name = 'MemoryIndexerCrashedError';
  }
}
