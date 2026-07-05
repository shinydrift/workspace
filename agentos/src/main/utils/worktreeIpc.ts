// IPC envelope shared by the main-side worktreeWorkerClient and the worktree
// utilityProcess. Mirrors the whisper worker's envelope (../audio/worker/whisperIpc.ts).
//   - Request:  main → worker. Correlation id matches Response.
//   - Response: worker → main. Settles the awaiting promise.
//   - Event:    worker → main. Log lines forwarded to the main eventLogger.
//   - Ready:    worker → main. Sent once the worker is up.

export type WorktreeRequest = {
  kind: 'request';
  id: string;
  method: string;
  args: unknown;
};

export type WorktreeResponse = {
  kind: 'response';
  id: string;
  result?: unknown;
  error?: { message: string };
};

export type WorktreeEvent = {
  kind: 'event';
  channel: string;
  payload: unknown;
};

export type WorktreeReady = {
  kind: 'ready';
  ok: boolean;
};

export type WorktreeMessage = WorktreeRequest | WorktreeResponse | WorktreeEvent;
export type WorktreeOutbound = WorktreeResponse | WorktreeEvent | WorktreeReady;

export class WorktreeWorkerCrashedError extends Error {
  constructor(message = 'Worktree worker crashed') {
    super(message);
    this.name = 'WorktreeWorkerCrashedError';
  }
}
