import fs from 'fs';
import path from 'path';
import type { SyncScope } from './core';

// Coalesce bursts of fs.watch events (rebase, npm i, branch switch) into a single
// re-sync trigger instead of one per filesystem event.
const WATCHER_DEBOUNCE_MS = 250;

type Debounced = { fn: () => void; cancel: () => void };

function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    fn: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

type ProjectEntry = { watchers: fs.FSWatcher[]; cancelDebounce: () => void };

export class MemoryWatcherRegistry {
  private entries = new Map<string, ProjectEntry>();

  private closeEntry(entry: ProjectEntry): void {
    // Cancel any pending debounced fire before closing the watchers so we don't
    // leave a setTimeout in flight that calls onDirty after the project is gone.
    entry.cancelDebounce();
    for (const w of entry.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  }

  ensure(scope: SyncScope, onDirty: () => void): void {
    if (this.entries.has(scope.projectId)) return;
    const projectWatchers: fs.FSWatcher[] = [];
    const debounced = debounce(onDirty, WATCHER_DEBOUNCE_MS);
    const projectMemoryPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId) : null;
    if (projectMemoryPath && fs.existsSync(projectMemoryPath)) {
      try {
        projectWatchers.push(fs.watch(projectMemoryPath, { recursive: true }, debounced.fn));
      } catch {
        /* ignore */
      }
    }
    for (const extraPath of scope.extraMemoryPaths ?? []) {
      if (fs.existsSync(extraPath)) {
        try {
          projectWatchers.push(fs.watch(extraPath, { recursive: true }, debounced.fn));
        } catch {
          /* ignore */
        }
      }
    }
    this.entries.set(scope.projectId, { watchers: projectWatchers, cancelDebounce: debounced.cancel });
  }

  closeAll(): void {
    for (const entry of this.entries.values()) this.closeEntry(entry);
    this.entries.clear();
  }

  delete(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (entry) {
      this.closeEntry(entry);
      this.entries.delete(projectId);
    }
  }
}
