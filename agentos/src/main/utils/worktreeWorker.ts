// Worktree git/docker utility process. Owns every `git`/`docker` subprocess spawn
// for worktree lifecycle, keeping them off the Electron main thread. The main
// process talks to this via the envelope in ./worktreeIpc.ts.

import * as engine from './worktreeEngine';
import { setWorktreeEngineLogger } from './worktreeEngine';
import type { WorktreeMessage, WorktreeOutbound, WorktreeRequest } from './worktreeIpc';

interface ParentPortLike {
  postMessage: (msg: WorktreeOutbound) => void;
  on: (event: 'message', listener: (event: { data: WorktreeMessage }) => void) => void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) {
  console.error('[worktree-worker] missing parentPort — must be spawned via utilityProcess.fork');
  process.exit(1);
}

function send(msg: WorktreeOutbound): void {
  parentPort!.postMessage(msg);
}

// Forward engine log lines to the main process's eventLogger (this process has no window).
setWorktreeEngineLogger((level, message, meta) =>
  send({ kind: 'event', channel: 'worktree:log', payload: { level, message, meta } })
);

async function handleRequest(req: WorktreeRequest): Promise<void> {
  const respond = (result: unknown): void => send({ kind: 'response', id: req.id, result });
  const fail = (err: unknown): void =>
    send({ kind: 'response', id: req.id, error: { message: err instanceof Error ? err.message : String(err) } });

  try {
    const a = req.args as Record<string, unknown>;
    switch (req.method) {
      case 'isWorktreeClean':
        respond(engine.isWorktreeClean(a.worktreePath as string));
        return;
      case 'isWorktreeRegistered':
        respond(engine.isWorktreeRegistered(a.worktreePath as string));
        return;
      case 'isBranchSyncedWithRemote':
        respond(engine.isBranchSyncedWithRemote(a.worktreePath as string));
        return;
      case 'pruneOrphanWorktrees':
        engine.pruneOrphanWorktrees(new Set(a.activeWorktreePaths as string[]), new Set(a.projectPaths as string[]));
        respond(null);
        return;
      case 'removeSessionWorktree':
        engine.removeSessionWorktree(a.worktreePath as string);
        respond(null);
        return;
      case 'getTaskGitSummary':
        respond(
          engine.getTaskGitSummary(
            a.projectPath as string,
            a.options as { branch?: string | null; worktreePath?: string | null }
          )
        );
        return;
      case 'createSessionWorktree':
        respond(
          await engine.createSessionWorktree(a.baseDir as string, a.sessionName as string, a.sessionId as string)
        );
        return;
      default:
        throw new Error(`Unknown worktree worker method: ${req.method}`);
    }
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
