// Main-process proxy for AgentOSMemoryService. Every method forwards to the
// memory utilityProcess via workerClient — the heavy work (sqlite transactions,
// tree-sitter parsing, local llama inference) runs there. Public API matches
// the pre-Phase-4 service except that previously-sync methods are now async.

import { installMemoryRuntime, runtimeProjects, runtimeLogger } from './runtime';
import { createMainMemoryRuntime } from './runtime/mainImpl';
import { initDbDir, getProjectDb } from './projectDb';
import { type MemoryWorkerClient } from './workerClient';
import { getMemoryWorkerClient } from './workerClientDefaults';
import type {
  MemorySearchHit,
  CodeSearchHit,
  MemoryListResult,
  MemoryEntryRecord,
  MemoryThreadChunk,
  MemoryProjectStats,
  MemoryDoctorResult,
  MemoryHealthReport,
} from '../../shared/types';
import type { CodeSearchParams } from './search';
import type { EntityType, GraphQueryResult, EdgeRelation } from './graph';

type ServiceSearchParams = {
  projectId?: string | null;
  threadId?: string | null;
  query: string;
  maxResults?: number;
  minScore?: number;
  source?: 'all' | 'memory' | 'sessions' | 'code';
};

export class AgentOSMemoryService {
  private homeDir: string | null = null;
  private client: MemoryWorkerClient;
  private runtimeInstalled = false;

  constructor(client?: MemoryWorkerClient) {
    this.client = client ?? getMemoryWorkerClient();
  }

  configure(homeDir: string): void {
    this.homeDir = homeDir;
    if (!this.runtimeInstalled) {
      installMemoryRuntime(createMainMemoryRuntime());
      this.runtimeInstalled = true;
    }
    // Initialize the projectDb module on the main side too: kanban (kanban/db.ts),
    // analytics (analyticsQueries.ts), and project deletion (projectHandlers.ts)
    // still reach into the project sqlite files directly from main, so they need
    // memoryDbDir set. Pre-open each known project DB so schema migrations run
    // main-side once — that way the worker's later open is a no-op for the
    // migrations check and the two processes don't race the __drizzle_migrations
    // table create on first launch.
    initDbDir(homeDir);
    // Defer the per-project open+migrate loop off the synchronous boot path —
    // opening N sqlite DBs (each running migrations + the chunks backfill) would
    // otherwise block the main thread during startup. setImmediate still runs it
    // well before the worker's first project-DB open, which waits on the worker
    // process spawning and its native-module probes, so the main-runs-migrations-
    // first ordering above is preserved.
    setImmediate(() => {
      for (const project of runtimeProjects()) {
        try {
          getProjectDb(project.id);
        } catch (err) {
          runtimeLogger.warn('memory', 'pre-warm project DB failed', {
            projectId: project.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
    // Surface boot failures loudly — silent rejection here hides a missing
    // indexer.js bundle or a native-module load crash.
    this.client.ensureStarted(homeDir).catch((err) => {
      runtimeLogger.error('memory', 'Memory indexer failed to start', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async warmup(): Promise<void> {
    if (!this.homeDir) throw new Error('AgentOSMemoryService not configured.');
    // ensureStarted now runs warmup as part of every spawn, so this is just a
    // barrier to confirm the worker is ready. Kept as a public method for the
    // bootstrap Phase 3 hook.
    await this.client.ensureStarted(this.homeDir);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  saveChunk(params: {
    projectId?: string | null;
    threadId?: string | null;
    summary: string;
    text: string;
    chunkId?: string;
  }): Promise<{ chunkId: string }> {
    return this.client.call('saveChunk', params);
  }

  linkEntities(params: {
    projectId?: string | null;
    threadId?: string | null;
    chunkId?: string;
    entities?: Array<{ name: string; type: EntityType; observation?: string }>;
    edges?: Array<{ from: string; to: string; relation: EdgeRelation }>;
  }): Promise<void> {
    return this.client.call('linkEntities', params);
  }

  addObservation(params: {
    projectId?: string | null;
    threadId?: string | null;
    entityName: string;
    entityType: EntityType;
    observation: string;
    sourceChunkId?: string;
  }): Promise<void> {
    return this.client.call('addObservation', params);
  }

  status(projectId?: string | null, threadId?: string | null): Promise<unknown> {
    return this.client.call('status', { projectId, threadId });
  }

  reindex(projectId?: string | null, threadId?: string | null): Promise<unknown> {
    // Full re-sync of memory + code; on a large project this can take many
    // minutes. Opt out of the default per-call timeout (0 = no timeout).
    return this.client.call('reindex', { projectId, threadId }, { timeoutMs: 0 });
  }

  flushPending(projectId?: string): Promise<void> {
    return this.client.call('flushPending', { projectId });
  }

  graphAll(
    projectId: string | null | undefined,
    threadId: string | null | undefined,
    topK = 2000
  ): Promise<GraphQueryResult> {
    return this.client.call('graphAll', { projectId, threadId, topK });
  }

  graphAllPage(
    projectId: string | null | undefined,
    threadId: string | null | undefined,
    offset: number,
    limit: number
  ): Promise<GraphQueryResult & { hasMore: boolean }> {
    return this.client.call('graphAllPage', { projectId, threadId, offset, limit });
  }

  graphQuery(
    projectId: string | null | undefined,
    threadId: string | null | undefined,
    entityName: string,
    options: { maxHops?: number; relationTypes?: EdgeRelation[]; topK?: number } = {}
  ): Promise<GraphQueryResult> {
    return this.client.call('graphQuery', { projectId, threadId, entityName, options });
  }

  getEntityChunks(projectId: string, entityId: string): Promise<string[]> {
    return this.client.call('getEntityChunks', { projectId, entityId });
  }

  doctor(projectId?: string | null, threadId?: string | null): Promise<MemoryDoctorResult> {
    return this.client.call('doctor', { projectId, threadId });
  }

  healthCheck(projectId?: string | null, threadId?: string | null): Promise<MemoryHealthReport> {
    return this.client.call('healthCheck', { projectId, threadId });
  }

  save(params: {
    projectId?: string | null;
    threadId?: string | null;
    path: string;
    content: string;
    mode?: 'overwrite' | 'append';
  }): Promise<{ savedPath: string; bytesWritten: number }> {
    return this.client.call('save', params);
  }

  search(params: ServiceSearchParams): Promise<MemorySearchHit[]> {
    return this.client.call('search', params);
  }

  searchCode(params: CodeSearchParams): Promise<CodeSearchHit[]> {
    return this.client.call('searchCode', params);
  }

  get(params: {
    projectId?: string | null;
    threadId?: string | null;
    entryId?: string;
    path?: string;
    skipExpansion?: boolean;
  }): Promise<MemoryEntryRecord | null> {
    return this.client.call('get', params);
  }

  listChunks(params: {
    projectId?: string | null;
    threadId?: string | null;
    source?: 'all' | 'memory' | 'sessions' | 'code';
    page: number;
    pageSize: number;
  }): Promise<MemoryListResult> {
    return this.client.call('listChunks', params);
  }

  deleteChunk(params: { projectId?: string | null; threadId?: string | null; chunkId: string }): Promise<void> {
    return this.client.call('deleteChunk', params);
  }

  deleteFile(params: { projectId?: string | null; threadId?: string | null; path: string }): Promise<void> {
    return this.client.call('deleteFile', params);
  }

  updateChunk(params: {
    projectId?: string | null;
    threadId?: string | null;
    chunkId: string;
    text: string;
  }): Promise<void> {
    return this.client.call('updateChunk', params);
  }

  pinChunk(params: {
    projectId?: string | null;
    threadId?: string | null;
    chunkId: string;
    pinned: boolean;
  }): Promise<void> {
    return this.client.call('pinChunk', params);
  }

  getThreadChunks(threadId: string, limit = 5): Promise<MemoryThreadChunk[]> {
    return this.client.call('getThreadChunks', { threadId, limit });
  }

  getGlobalExpansionCounts(): Promise<{ thisWeek: number; lastWeek: number }> {
    return this.client.call('getGlobalExpansionCounts', null);
  }

  getProjectStats(projectId: string): Promise<MemoryProjectStats> {
    return this.client.call('getProjectStats', { projectId });
  }

  invalidateProject(projectId: string): Promise<void> {
    return this.client.call('invalidateProject', { projectId });
  }

  resetEmbeddings(projectId: string, target: 'memory' | 'sessions' | 'code' | 'graph'): Promise<{ cleared: number }> {
    return this.client.call('resetEmbeddings', { projectId, target });
  }

  deleteData(projectId: string, target: 'memory' | 'sessions' | 'code' | 'graph'): Promise<{ cleared: number }> {
    return this.client.call('deleteData', { projectId, target });
  }

  // Targeted rebuild: clears entities + edges only (preserves observations).
  // The renderer's "Reindex Graph" button — distinct from deleteData('graph'),
  // which is the destructive Reset operation.
  reindexGraph(projectId: string): Promise<{ entityCount: number; edgeCount: number }> {
    return this.client.call('reindexGraph', { projectId });
  }

  // Lifecycle hook for app quit — drains pending work and tears down the worker.
  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }
}

export const agentOSMemoryService = new AgentOSMemoryService();
