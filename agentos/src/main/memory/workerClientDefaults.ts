import path from 'path';
import { utilityProcess } from 'electron';
import { settingsEvents, getStore } from '../store/index';
import { getAllProjects } from '../threads/db';
import * as threadStore from '../threads/threadStore';
import { broadcastToWindows } from '../sessions/broadcaster';
import { writeAppLog } from '../utils/eventLog';
import type { AppSettings } from '../../shared/types';
import { MemoryWorkerClient, type MemoryWorkerClientOpts, type WorkerChild } from './workerClient';
import type { RuntimeThread } from './runtime';

function projectThread(t: { id: string; name: string; projectId: string }): RuntimeThread {
  return { id: t.id, name: t.name, projectId: t.projectId };
}

function snapshotState(): ReturnType<MemoryWorkerClientOpts['snapshot']> {
  return {
    settings: getStore().get('settings'),
    projects: getAllProjects(),
    threads: threadStore.getAllThreads().map(projectThread),
  };
}

function resolveIndexerEntry(): string {
  // In packaged builds, electron-forge writes the indexer bundle next to the
  // main bundle. In dev, vite emits it to .vite/build/indexer.js. Both paths
  // resolve relative to the main process entry — __dirname here is the bundle
  // location, not the source tree.
  return path.join(__dirname, 'indexer.js');
}

function defaultFork(entryPath: string): WorkerChild {
  const child = utilityProcess.fork(entryPath, [], {
    serviceName: 'agentos-memory-indexer',
    stdio: 'inherit',
  });
  return child as unknown as WorkerChild;
}

function defaultSubscribeSettings(cb: (s: AppSettings) => void): () => void {
  settingsEvents.on('change', cb);
  return () => settingsEvents.off('change', cb);
}

let singleton: MemoryWorkerClient | null = null;

export function getMemoryWorkerClient(opts: { entryPath?: string } = {}): MemoryWorkerClient {
  if (!singleton) {
    singleton = new MemoryWorkerClient({
      entryPath: opts.entryPath ?? resolveIndexerEntry(),
      forkFn: defaultFork,
      subscribeSettings: defaultSubscribeSettings,
      snapshot: snapshotState,
      log: writeAppLog,
      broadcast: broadcastToWindows,
    });
  }
  return singleton;
}

export function resetMemoryWorkerClientForTests(): void {
  singleton = null;
}
