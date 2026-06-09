// Worker-side dispatcher. Instantiates the memory service stack and routes
// incoming method names to handlers. Kept in lock-step with the main-side
// proxy in ../service.ts — the dispatch table here is the canonical list of
// methods the worker accepts.

import { initDbDir, closeProjectDb, getProjectDb } from '../projectDb';
import { checkVecTable } from '../vecSupport';
import { MemoryStatsService } from '../statsService';
import { MemoryContentService } from '../contentService';
import { MemoryGraphService } from '../graph';
import { MemorySyncCoordinator } from '../sync';
import type { EdgeRelation, EntityType } from '../graph';
import type { CodeSearchParams } from '../search';
import { runtimeLogger } from '../runtime';

type ServiceSearchParams = {
  projectId?: string | null;
  threadId?: string | null;
  query: string;
  maxResults?: number;
  minScore?: number;
  source?: 'all' | 'memory' | 'sessions' | 'code';
};

export interface WorkerEntry {
  configure(homeDir: string): void;
  dispatch(method: string, args: unknown): Promise<unknown>;
  flushPending(): Promise<void>;
}

export function agentOSMemoryWorker(): WorkerEntry {
  const stats = new MemoryStatsService();
  const content = new MemoryContentService(stats);
  const graph = new MemoryGraphService();
  const sync = new MemorySyncCoordinator();

  function clearDataTransaction(
    db: ReturnType<typeof getProjectDb>,
    hasVecTable: boolean,
    target: 'memory' | 'sessions' | 'code' | 'graph'
  ): number {
    let cleared = 0;
    db.transaction(() => {
      if (target === 'memory' || target === 'sessions') {
        if (hasVecTable) {
          db.prepare('DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE source = ?)').run(target);
        }
        db.prepare('DELETE FROM chunks_fts WHERE source = ?').run(target);
        db.prepare('DELETE FROM embedding_cache WHERE hash IN (SELECT DISTINCT hash FROM chunks WHERE source = ?)').run(
          target
        );
        cleared = db.prepare('DELETE FROM chunks WHERE source = ?').run(target).changes;
      } else if (target === 'code') {
        if (hasVecTable) {
          db.prepare("DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE source = 'code')").run();
        }
        db.prepare("DELETE FROM chunks_fts WHERE source = 'code'").run();
        db.prepare(
          "DELETE FROM embedding_cache WHERE hash IN (SELECT DISTINCT hash FROM chunks WHERE source = 'code')"
        ).run();
        cleared = db.prepare("DELETE FROM chunks WHERE source = 'code'").run().changes;
        db.prepare('DELETE FROM files').run();
      } else {
        db.prepare('DELETE FROM observations_fts').run();
        db.prepare('DELETE FROM observations').run();
        db.prepare('DELETE FROM edges').run();
        cleared = db.prepare('DELETE FROM entities').run().changes;
      }
    })();
    return cleared;
  }

  type ArgMap = {
    warmup: void;
    saveChunk: {
      projectId?: string | null;
      threadId?: string | null;
      summary: string;
      text: string;
      chunkId?: string;
    };
    linkEntities: {
      projectId?: string | null;
      threadId?: string | null;
      chunkId?: string;
      entities?: Array<{ name: string; type: EntityType; observation?: string }>;
      edges?: Array<{ from: string; to: string; relation: EdgeRelation }>;
    };
    addObservation: {
      projectId?: string | null;
      threadId?: string | null;
      entityName: string;
      entityType: EntityType;
      observation: string;
      sourceChunkId?: string;
    };
    status: { projectId?: string | null; threadId?: string | null };
    reindex: { projectId?: string | null; threadId?: string | null };
    flushPending: { projectId?: string };
    graphAll: { projectId?: string | null; threadId?: string | null; topK?: number };
    graphAllPage: {
      projectId?: string | null;
      threadId?: string | null;
      offset: number;
      limit: number;
    };
    graphQuery: {
      projectId?: string | null;
      threadId?: string | null;
      entityName: string;
      options?: { maxHops?: number; relationTypes?: EdgeRelation[]; topK?: number };
    };
    getEntityChunks: { projectId: string; entityId: string };
    doctor: { projectId?: string | null; threadId?: string | null };
    healthCheck: { projectId?: string | null; threadId?: string | null };
    save: {
      projectId?: string | null;
      threadId?: string | null;
      path: string;
      content: string;
      mode?: 'overwrite' | 'append';
    };
    search: ServiceSearchParams;
    searchCode: CodeSearchParams;
    get: {
      projectId?: string | null;
      threadId?: string | null;
      entryId?: string;
      path?: string;
      skipExpansion?: boolean;
    };
    listChunks: {
      projectId?: string | null;
      threadId?: string | null;
      source?: 'all' | 'memory' | 'sessions' | 'code';
      page: number;
      pageSize: number;
    };
    deleteChunk: { projectId?: string | null; threadId?: string | null; chunkId: string };
    deleteFile: { projectId?: string | null; threadId?: string | null; path: string };
    updateChunk: { projectId?: string | null; threadId?: string | null; chunkId: string; text: string };
    pinChunk: { projectId?: string | null; threadId?: string | null; chunkId: string; pinned: boolean };
    getThreadChunks: { threadId: string; limit?: number };
    getGlobalExpansionCounts: void;
    getProjectStats: { projectId: string };
    invalidateProject: { projectId: string };
    resetEmbeddings: { projectId: string; target: 'memory' | 'sessions' | 'code' | 'graph' };
    deleteData: { projectId: string; target: 'memory' | 'sessions' | 'code' | 'graph' };
    reindexGraph: { projectId: string };
  };

  const handlers: { [K in keyof ArgMap]: (a: ArgMap[K]) => Promise<unknown> | unknown } = {
    warmup: () =>
      sync.warmup().catch((err) =>
        runtimeLogger.warn('memory', 'Startup init failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      ),
    saveChunk: (a) => {
      const threadId = a.threadId?.trim();
      if (!threadId) throw new Error('threadId is required to save a session chunk.');
      const scope = sync.resolveScope(a.projectId, threadId);
      return content.saveChunk(scope, { threadId, summary: a.summary, text: a.text, chunkId: a.chunkId });
    },
    linkEntities: (a) => {
      if (!a.entities?.length && !a.edges?.length) return;
      const scope = sync.resolveScope(a.projectId, a.threadId);
      graph.linkEntities(scope, { chunkId: a.chunkId, entities: a.entities, edges: a.edges });
    },
    addObservation: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      graph.addObservation(scope, {
        entityName: a.entityName,
        entityType: a.entityType,
        observation: a.observation,
        sourceChunkId: a.sourceChunkId,
      });
    },
    status: (a) => sync.status(sync.resolveScope(a.projectId, a.threadId)),
    reindex: (a) => sync.reindex(sync.resolveScope(a.projectId, a.threadId)),
    flushPending: (a) => sync.flushPending(a.projectId),
    graphAll: (a) => graph.graphAll(sync.resolveScope(a.projectId, a.threadId), a.topK ?? 2000),
    graphAllPage: (a) => graph.graphAllPage(sync.resolveScope(a.projectId, a.threadId), a.offset, a.limit),
    graphQuery: (a) => graph.graphQuery(sync.resolveScope(a.projectId, a.threadId), a.entityName, a.options ?? {}),
    getEntityChunks: (a) => graph.getEntityChunks(a.projectId, a.entityId),
    doctor: (a) => sync.doctor(sync.resolveScope(a.projectId, a.threadId)),
    healthCheck: (a) => sync.healthCheck(sync.resolveScope(a.projectId, a.threadId)),
    save: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      return content.save(scope, { path: a.path, content: a.content, mode: a.mode });
    },
    search: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      return sync.search(scope, a);
    },
    searchCode: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      return sync.searchCode(scope, a);
    },
    get: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      return content.get(scope, { entryId: a.entryId, path: a.path, skipExpansion: a.skipExpansion });
    },
    listChunks: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      return content.listChunks(scope, { source: a.source, page: a.page, pageSize: a.pageSize });
    },
    deleteChunk: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      content.deleteChunk(scope, a.chunkId);
    },
    deleteFile: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      content.deleteFile(scope, a.path);
    },
    updateChunk: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      content.updateChunk(scope, a.chunkId, a.text);
    },
    pinChunk: (a) => {
      const scope = sync.resolveScope(a.projectId, a.threadId);
      content.pinChunk(scope, a.chunkId, a.pinned);
    },
    getThreadChunks: (a) => {
      try {
        const scope = sync.resolveScope(undefined, a.threadId);
        return stats.getThreadChunks(scope.projectId, a.threadId, a.limit ?? 5);
      } catch {
        return [];
      }
    },
    getGlobalExpansionCounts: () => stats.getGlobalExpansionCounts(),
    getProjectStats: (a) => stats.getProjectStats(a.projectId),
    invalidateProject: (a) => {
      closeProjectDb(a.projectId);
      sync.clearProject(a.projectId);
      stats.invalidate(a.projectId);
    },
    resetEmbeddings: (a) => {
      const db = getProjectDb(a.projectId);
      const hasVecTable = checkVecTable(db);
      const cleared = clearDataTransaction(db, hasVecTable, a.target);
      sync.clearProject(a.projectId);
      stats.invalidate(a.projectId);
      const scope = sync.resolveScope(a.projectId, null);
      const reembedTarget = a.target === 'code' ? 'code' : 'memory';
      sync.scheduleReembed(scope, reembedTarget);
      return { cleared };
    },
    deleteData: (a) => {
      const db = getProjectDb(a.projectId);
      const hasVecTable = checkVecTable(db);
      const cleared = clearDataTransaction(db, hasVecTable, a.target);
      sync.clearProject(a.projectId);
      stats.invalidate(a.projectId);
      return { cleared };
    },
    // Targeted rebuild for the renderer's Reindex Graph action. Preserves
    // observations + observations_fts; only entities + edges are dropped.
    reindexGraph: (a) => {
      const db = getProjectDb(a.projectId);
      db.transaction(() => {
        db.exec('DELETE FROM edges');
        db.exec('DELETE FROM entities');
      })();
      sync.clearProject(a.projectId);
      stats.invalidate(a.projectId);
      return { entityCount: 0, edgeCount: 0 };
    },
  };

  return {
    configure(homeDir: string): void {
      initDbDir(homeDir);
      sync.configure(homeDir);
    },
    async dispatch(method: string, args: unknown): Promise<unknown> {
      const handler = (handlers as Record<string, (a: unknown) => Promise<unknown> | unknown>)[method];
      if (!handler) throw new Error(`Unknown memory worker method: ${method}`);
      return await handler(args);
    },
    async flushPending(): Promise<void> {
      await sync.flushPending();
    },
  };
}
