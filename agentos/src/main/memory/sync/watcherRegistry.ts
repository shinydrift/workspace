import fs from 'fs';
import path from 'path';
import type { SyncScope } from './core';

export class MemoryWatcherRegistry {
  private watchers = new Map<string, fs.FSWatcher[]>();

  private closeList(watchers: fs.FSWatcher[]): void {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  }

  ensure(scope: SyncScope, onDirty: () => void): void {
    if (this.watchers.has(scope.projectId)) return;
    const projectWatchers: fs.FSWatcher[] = [];
    const projectMemoryPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId) : null;
    if (projectMemoryPath && fs.existsSync(projectMemoryPath)) {
      try {
        projectWatchers.push(fs.watch(projectMemoryPath, { recursive: true }, onDirty));
      } catch {
        /* ignore */
      }
    }
    for (const extraPath of scope.extraMemoryPaths ?? []) {
      if (fs.existsSync(extraPath)) {
        try {
          projectWatchers.push(fs.watch(extraPath, { recursive: true }, onDirty));
        } catch {
          /* ignore */
        }
      }
    }
    this.watchers.set(scope.projectId, projectWatchers);
  }

  closeAll(): void {
    for (const watchers of this.watchers.values()) this.closeList(watchers);
    this.watchers.clear();
  }

  delete(projectId: string): void {
    const watchers = this.watchers.get(projectId);
    if (watchers) {
      this.closeList(watchers);
      this.watchers.delete(projectId);
    }
  }
}
