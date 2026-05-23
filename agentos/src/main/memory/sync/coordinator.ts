import path from 'path';
import fs from 'fs';
import { getStore, settingsEvents } from '../../store/index';
import { getAllProjects } from '../../threads/db';
import { eventLogger } from '../../utils/eventLog';
import { broadcastToWindows } from '../../sessions/broadcaster';
import { getProjectDb } from '../projectDb';
import { getProvider } from '../embedding/cache';
import { pruneOrphanData } from '../orphanPruner';
import { syncProject, syncCodeFiles, type SyncScope } from './core';
import { resolveSyncScope } from '../scopeResolver';
import { MemoryWatcherRegistry } from './watcherRegistry';
import {
  searchMemory,
  searchCode as execCodeSearch,
  invalidateProjectCfgCache,
  clearAllProjectCfgCaches,
  pruneOldSessions,
  type SearchParams,
  type CodeSearchParams,
} from '../search/engine';

// Coordinator search accepts the wider 'code' source value and dispatches to
// the appropriate ranker. searchMemory itself only accepts memory|sessions|all.
type CoordinatorSearchParams = Omit<SearchParams, 'source'> & {
  source?: 'all' | 'memory' | 'sessions' | 'code';
};
import { memoryStatus, memoryDoctor, memoryHealthCheck } from '../memoryDiagnostics';
import { persistMerkleRoot } from '../integrity';
import type { EmbeddingProvider } from '../embedding/provider';
import type {
  AppSettings,
  MemorySearchHit,
  CodeSearchHit,
  MemoryIndexStatusEvent,
  MemoryDoctorResult,
  MemoryIndexStatus,
  MemoryHealthReport,
} from '../../../shared/types';
import { IPC_EVENTS } from '../../../shared/types';

export class MemorySyncCoordinator {
  private homeDir: string | null = null;
  private memoryDir: string | null = null;
  private watcherRegistry = new MemoryWatcherRegistry();
  private syncedProjects = new Set<string>();
  private syncedCodeProjects = new Set<string>();
  private dirtyProjects = new Set<string>();
  private dirtyGen = new Map<string, number>();
  private memorySyncPromises = new Map<string, Promise<void>>();
  private codeIndexingPromises = new Map<string, Promise<void>>();
  private lastMemoryRootPath: string | null = null;
  private lastExtraMemoryPaths: string[] = [];
  private lastProviderKey = '';
  private maintenanceInterval: ReturnType<typeof setInterval> | null = null;

  configure(homeDir: string): void {
    if (this.homeDir) return;
    this.homeDir = homeDir;
    this.memoryDir = path.join(homeDir, '.agentos');
    const initialSettings = getStore().get('settings');
    this.lastMemoryRootPath = initialSettings.memoryRootPath ?? null;
    this.lastExtraMemoryPaths = initialSettings.extraMemoryPaths ?? [];
    settingsEvents.on('change', (updated) => this.onSettingsChange(updated));
  }

  async warmup(): Promise<void> {
    if (!this.homeDir || !this.memoryDir) return;

    // Defer orphan pruning — it does async FS work that shouldn't block the warmup hot path.
    const homeDir = this.homeDir;
    const memoryDir = this.memoryDir;
    setImmediate(() => {
      pruneOrphanData(homeDir, memoryDir).catch((err: unknown) => {
        eventLogger.warn('memory', 'Orphan prune failed', { err });
      });
    });

    const settings = getStore().get('settings');
    const memoryRootPath = settings.memoryRootPath ?? path.join(homeDir, '.agentos', 'memory', 'projects');
    await Promise.all(
      getAllProjects().map(async ({ id: projectId }) => {
        await fs.promises.mkdir(path.join(memoryRootPath, projectId), { recursive: true });
        const scope = resolveSyncScope(projectId, null, homeDir);
        this.scheduleMemorySync(scope);
      })
    );
    const provider = await getProvider(settings);
    this.lastProviderKey = provider?.providerKey ?? '';
    if (provider) {
      eventLogger.info('memory', 'Embedding provider ready', {
        provider: provider.id,
        model: provider.model,
        dims: provider.dims,
      });
    } else {
      eventLogger.warn('memory', 'No embedding provider available; memory search will use FTS-only');
    }
    if (!this.maintenanceInterval) {
      this.maintenanceInterval = setInterval(() => this.runMaintenance(), 3_600_000);
      this.maintenanceInterval.unref?.();
    }
  }

  resolveScope(projectId?: string | null, threadId?: string | null): SyncScope {
    if (!this.homeDir || !this.memoryDir) throw new Error('AgentOS memory service has not been initialized.');
    return resolveSyncScope(projectId, threadId, this.homeDir);
  }

  async search(scope: SyncScope, params: CoordinatorSearchParams): Promise<MemorySearchHit[]> {
    const settings = getStore().get('settings');
    const provider = await getProvider(settings);
    const dirty = !this.syncedProjects.has(scope.projectId) || this.dirtyProjects.has(scope.projectId);

    if (params.source === 'code') {
      // Code search reads only the code index. Don't block on memory sync; refresh
      // it in the background while awaiting the code index so cold-project searches
      // return real results instead of an empty list.
      if (dirty) void this.scheduleMemorySync(scope);
      await this.scheduleCodeIndex(scope);
      this.watcherRegistry.ensure(scope, () => {
        this.dirtyProjects.add(scope.projectId);
        this.dirtyGen.set(scope.projectId, (this.dirtyGen.get(scope.projectId) ?? 0) + 1);
      });
      const { source: _ignored, ...codeParams } = params;
      return execCodeSearch(scope, codeParams, settings, provider, getProjectDb(scope.projectId));
    }

    if (dirty) await this.scheduleMemorySync(scope);
    this.watcherRegistry.ensure(scope, () => {
      this.dirtyProjects.add(scope.projectId);
      this.dirtyGen.set(scope.projectId, (this.dirtyGen.get(scope.projectId) ?? 0) + 1);
    });
    const memoryParams: SearchParams = { ...params, source: params.source };
    return searchMemory(scope, memoryParams, settings, provider, getProjectDb(scope.projectId));
  }

  async searchCode(scope: SyncScope, params: CodeSearchParams): Promise<CodeSearchHit[]> {
    const settings = getStore().get('settings');
    const provider = await getProvider(settings);
    const dirty = !this.syncedProjects.has(scope.projectId) || this.dirtyProjects.has(scope.projectId);

    if (dirty) void this.scheduleMemorySync(scope);
    await this.scheduleCodeIndex(scope);
    this.watcherRegistry.ensure(scope, () => {
      this.dirtyProjects.add(scope.projectId);
      this.dirtyGen.set(scope.projectId, (this.dirtyGen.get(scope.projectId) ?? 0) + 1);
    });

    return execCodeSearch(scope, params, settings, provider, getProjectDb(scope.projectId));
  }

  private broadcastIndexStatus(event: MemoryIndexStatusEvent): void {
    broadcastToWindows(IPC_EVENTS.MEMORY_INDEX_STATUS, event);
  }

  // Kick off a background re-embed for the given target without waiting for a search trigger.
  // Memory sync always chains to a code index run in its finally(); for a memory-only reset
  // this is a fast no-op since the files table is intact and all file hashes still match.
  scheduleReembed(scope: SyncScope, target: 'memory' | 'code'): void {
    if (target === 'memory') {
      this.scheduleMemorySync(scope);
    } else {
      this.scheduleCodeIndex(scope);
    }
  }

  private scheduleMemorySync(scope: SyncScope): Promise<void> {
    const existing = this.memorySyncPromises.get(scope.projectId);
    if (existing) return existing;
    this.broadcastIndexStatus({ projectId: scope.projectId, phase: 'memory', state: 'started' });
    const settings = getStore().get('settings');
    const startGen = this.dirtyGen.get(scope.projectId) ?? 0;
    const p = getProvider(settings)
      .then((provider) => syncProject(scope, provider))
      .then(() => {
        this.syncedProjects.add(scope.projectId);
        if ((this.dirtyGen.get(scope.projectId) ?? 0) === startGen) {
          this.dirtyProjects.delete(scope.projectId);
        }
        try {
          persistMerkleRoot(getProjectDb(scope.projectId), scope.projectId);
        } catch {
          /* non-critical — don't fail sync if merkle root update fails */
        }
        this.broadcastIndexStatus({ projectId: scope.projectId, phase: 'memory', state: 'done' });
      })
      .catch((err) => {
        eventLogger.warn('memory', 'Background memory indexing failed', { err });
        this.broadcastIndexStatus({ projectId: scope.projectId, phase: 'memory', state: 'error' });
      })
      .finally(() => {
        this.memorySyncPromises.delete(scope.projectId);
        this.scheduleCodeIndex(scope);
      });
    this.memorySyncPromises.set(scope.projectId, p);
    return p;
  }

  private scheduleCodeIndex(scope: SyncScope): Promise<void> {
    const existing = this.codeIndexingPromises.get(scope.projectId);
    if (existing) return existing;
    if (this.syncedCodeProjects.has(scope.projectId) && !this.dirtyProjects.has(scope.projectId)) {
      return Promise.resolve();
    }
    this.broadcastIndexStatus({ projectId: scope.projectId, phase: 'code', state: 'started' });
    const settings = getStore().get('settings');
    const p = getProvider(settings)
      .then((provider) => syncCodeFiles(scope, provider))
      .then(() => {
        this.syncedCodeProjects.add(scope.projectId);
        this.broadcastIndexStatus({ projectId: scope.projectId, phase: 'code', state: 'done' });
      })
      .catch((err) => {
        eventLogger.warn('memory', 'Background code indexing failed', { err });
        this.broadcastIndexStatus({ projectId: scope.projectId, phase: 'code', state: 'error' });
      })
      .finally(() => this.codeIndexingPromises.delete(scope.projectId));
    this.codeIndexingPromises.set(scope.projectId, p);
    return p;
  }

  async reindex(scope: SyncScope): Promise<unknown> {
    await Promise.all([
      this.memorySyncPromises.get(scope.projectId) ?? Promise.resolve(),
      this.codeIndexingPromises.get(scope.projectId) ?? Promise.resolve(),
    ]);
    this.memorySyncPromises.delete(scope.projectId);
    this.codeIndexingPromises.delete(scope.projectId);
    const settings = getStore().get('settings');
    const provider = await getProvider(settings);
    const db = getProjectDb(scope.projectId);
    db.exec('DELETE FROM files');
    this.syncedCodeProjects.delete(scope.projectId);
    await syncProject(scope, provider);
    this.syncedProjects.add(scope.projectId);
    await syncCodeFiles(scope, provider);
    this.syncedCodeProjects.add(scope.projectId);
    try {
      persistMerkleRoot(db, scope.projectId);
    } catch {
      /* non-critical */
    }
    this.watcherRegistry.ensure(scope, () => this.dirtyProjects.add(scope.projectId));
    return this.status(scope);
  }

  async status(scope: SyncScope): Promise<MemoryIndexStatus> {
    const settings = getStore().get('settings');
    const provider = await getProvider(settings);
    return memoryStatus(scope, getProjectDb(scope.projectId), provider, this.homeDir!);
  }

  async doctor(scope: SyncScope): Promise<MemoryDoctorResult> {
    const settings = getStore().get('settings');
    let provider: EmbeddingProvider | null = null;
    let providerError: string | undefined;
    try {
      provider = await getProvider(settings);
    } catch (err) {
      providerError = err instanceof Error ? err.message : String(err);
    }
    return memoryDoctor(scope, getProjectDb(scope.projectId), provider, providerError);
  }

  async healthCheck(scope: SyncScope): Promise<MemoryHealthReport> {
    const settings = getStore().get('settings');
    const provider = await getProvider(settings).catch((): null => null);
    return memoryHealthCheck(scope, getProjectDb(scope.projectId), provider);
  }

  clearProject(projectId: string): void {
    this.syncedProjects.delete(projectId);
    this.syncedCodeProjects.delete(projectId);
    this.dirtyProjects.delete(projectId);
    this.dirtyGen.delete(projectId);
    this.memorySyncPromises.delete(projectId);
    this.codeIndexingPromises.delete(projectId);
    this.watcherRegistry.delete(projectId);
    if (this.homeDir) {
      const scope = resolveSyncScope(projectId, null, this.homeDir);
      if (scope.projectPath) invalidateProjectCfgCache(scope.projectPath);
    }
  }

  private onSettingsChange(updated: AppSettings): void {
    const newRoot = updated.memoryRootPath ?? null;
    const newExtra = updated.extraMemoryPaths ?? [];
    const pathsChanged =
      newRoot !== this.lastMemoryRootPath || JSON.stringify(newExtra) !== JSON.stringify(this.lastExtraMemoryPaths);
    this.lastMemoryRootPath = newRoot;
    this.lastExtraMemoryPaths = newExtra;
    if (pathsChanged) {
      this.watcherRegistry.closeAll();
      this.syncedProjects.clear();
      this.syncedCodeProjects.clear();
      this.memorySyncPromises.clear();
      this.codeIndexingPromises.clear();
      clearAllProjectCfgCaches();
    }
    // Detect embedding provider/model changes — mark all synced projects dirty to force re-embed
    getProvider(updated)
      .then((provider) => {
        const newKey = provider?.providerKey ?? '';
        if (newKey !== this.lastProviderKey) {
          this.lastProviderKey = newKey;
          clearAllProjectCfgCaches();
          for (const projectId of [...this.syncedProjects]) {
            this.syncedProjects.delete(projectId);
            this.syncedCodeProjects.delete(projectId);
            this.dirtyProjects.add(projectId);
            this.dirtyGen.set(projectId, (this.dirtyGen.get(projectId) ?? 0) + 1);
          }
        }
      })
      .catch(() => {
        /* ignore provider resolution errors during settings change */
      });
  }

  private runMaintenance(): void {
    const settings = getStore().get('settings');
    for (const projectId of this.syncedProjects) {
      try {
        const scope = resolveSyncScope(projectId, null, this.homeDir!);
        pruneOldSessions(getProjectDb(projectId), scope, settings);
      } catch {
        /* non-critical */
      }
    }
  }
}
