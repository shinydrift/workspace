// Assembles the worktree worker client singleton with the real Electron
// utilityProcess.fork + eventLogger wiring. Kept apart from worktreeWorkerClient.ts
// so that (electron-free) module stays unit-testable with a fake child.

import path from 'path';
import { utilityProcess } from 'electron';
import { eventLogger } from './eventLog';
import { WorktreeWorkerClient, type WorktreeWorkerChild } from './worktreeWorkerClient';

const LOG = 'worktree';

function resolveEntry(): string {
  // Bundled next to the main entry — __dirname is the bundle location.
  return path.join(__dirname, 'worktreeWorker.js');
}

function defaultFork(entryPath: string): WorktreeWorkerChild {
  const child = utilityProcess.fork(entryPath, [], {
    serviceName: 'agentos-worktree-worker',
    stdio: 'inherit',
  });
  return child as unknown as WorktreeWorkerChild;
}

export const worktreeWorkerClient = new WorktreeWorkerClient({
  entryPath: resolveEntry(),
  forkFn: defaultFork,
  log: (level, message, meta) => eventLogger[level](LOG, message, meta),
});
