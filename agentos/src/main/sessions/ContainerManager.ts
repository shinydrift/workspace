import fs from 'fs';
import type { ContainerSummary } from '../../shared/types';
import {
  pruneContainersIfNeeded,
  removeContainerByName,
  listContainerSummaries as listContainerSummariesFn,
  touchContainerFromActivity as touchContainerFromActivityFn,
} from './containerProjectManager';

export class ContainerManager {
  readonly dockerfileWatchers = new Map<string, fs.FSWatcher>();
  readonly dockerfileRebuildingProjects = new Set<string>();
  readonly globalDockerfileWatcherRef = { current: null as fs.FSWatcher | null };
  private lastRegistryTouchByThread = new Map<string, number>();
  private lastPruneAtMs = 0;
  private idleTimers = new Map<string, NodeJS.Timeout>();

  async touchFromActivity(threadId: string, force = false): Promise<void> {
    await touchContainerFromActivityFn(this.lastRegistryTouchByThread, threadId, force);
  }

  scheduleIdleStop(threadId: string, ms: number, callback: () => void): void {
    this.cancelIdleStop(threadId);
    this.idleTimers.set(threadId, setTimeout(callback, ms));
  }

  cancelIdleStop(threadId: string): void {
    const timer = this.idleTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(threadId);
    }
  }

  clearThread(threadId: string): void {
    this.lastRegistryTouchByThread.delete(threadId);
    this.cancelIdleStop(threadId);
  }

  async prune(opts?: { force?: boolean }): Promise<{ pruned: string[]; errors: string[] }> {
    const result = await pruneContainersIfNeeded(this.lastPruneAtMs, opts);
    this.lastPruneAtMs = result.newLastPruneAt;
    return { pruned: result.pruned, errors: result.errors };
  }

  async remove(containerName: string): Promise<void> {
    await removeContainerByName(containerName);
  }

  async listSummaries(): Promise<ContainerSummary[]> {
    return listContainerSummariesFn();
  }
}
