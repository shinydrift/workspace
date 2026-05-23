import { initDbDir, getProjectDb, closeProjectDb } from './projectDb';
import { checkVecTable } from './vecSupport';
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

// Service-level search params accept the wider 'code' source value (the IPC
// boundary's MemorySearchRequest also accepts 'code') plus optional projectId
// for MCP callers that route by project rather than thread.
type ServiceSearchParams = {
  projectId?: string | null;
  threadId?: string | null;
  query: string;
  maxResults?: number;
  minScore?: number;
  source?: 'all' | 'memory' | 'sessions' | 'code';
};
import type { EntityType, GraphQueryResult, EdgeRelation } from './graph';
import { MemoryStatsService } from './statsService';
import { MemoryContentService } from './contentService';
import { MemoryGraphService } from './graph';
import { MemorySyncCoordinator } from './sync';
import { eventLogger } from '../utils/eventLog';

export class AgentOSMemoryService {
  private stats = new MemoryStatsService();
  private content = new MemoryContentService(this.stats);
  private graph = new MemoryGraphService();
  private sync = new MemorySyncCoordinator();

  configure(homeDir: string): void {
    initDbDir(homeDir);
    this.sync.configure(homeDir);
  }

  async warmup(): Promise<void> {
    await this.sync.warmup().catch((err) => {
      eventLogger.warn('memory', 'Startup init failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async saveChunk(params: {
    projectId?: string | null;
    threadId?: string | null;
    summary: string;
    text: string;
    chunkId?: string;
  }): Promise<{ chunkId: string }> {
    const threadId = params.threadId?.trim();
    if (!threadId) throw new Error('threadId is required to save a session chunk.');
    const scope = this.sync.resolveScope(params.projectId, threadId);
    return this.content.saveChunk(scope, {
      threadId,
      summary: params.summary,
      text: params.text,
      chunkId: params.chunkId,
    });
  }

  linkEntities(params: {
    projectId?: string | null;
    threadId?: string | null;
    chunkId?: string;
    entities?: Array<{ name: string; type: EntityType; observation?: string }>;
    edges?: Array<{ from: string; to: string; relation: EdgeRelation }>;
  }): void {
    if (!params.entities?.length && !params.edges?.length) return;
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    this.graph.linkEntities(scope, { chunkId: params.chunkId, entities: params.entities, edges: params.edges });
  }

  addObservation(params: {
    projectId?: string | null;
    threadId?: string | null;
    entityName: string;
    entityType: EntityType;
    observation: string;
    sourceChunkId?: string;
  }): void {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    this.graph.addObservation(scope, {
      entityName: params.entityName,
      entityType: params.entityType,
      observation: params.observation,
      sourceChunkId: params.sourceChunkId,
    });
  }

  async status(projectId?: string | null, threadId?: string | null): Promise<unknown> {
    return this.sync.status(this.sync.resolveScope(projectId, threadId));
  }

  async reindex(projectId?: string | null, threadId?: string | null): Promise<unknown> {
    return this.sync.reindex(this.sync.resolveScope(projectId, threadId));
  }

  graphAll(projectId: string | null | undefined, threadId: string | null | undefined, topK = 2000): GraphQueryResult {
    return this.graph.graphAll(this.sync.resolveScope(projectId, threadId), topK);
  }

  graphAllPage(
    projectId: string | null | undefined,
    threadId: string | null | undefined,
    offset: number,
    limit: number
  ): GraphQueryResult & { hasMore: boolean } {
    return this.graph.graphAllPage(this.sync.resolveScope(projectId, threadId), offset, limit);
  }

  async graphQuery(
    projectId: string | null | undefined,
    threadId: string | null | undefined,
    entityName: string,
    options: { maxHops?: number; relationTypes?: EdgeRelation[]; topK?: number } = {}
  ): Promise<GraphQueryResult> {
    return this.graph.graphQuery(this.sync.resolveScope(projectId, threadId), entityName, options);
  }

  getEntityChunks(projectId: string, entityId: string): string[] {
    return this.graph.getEntityChunks(projectId, entityId);
  }

  async doctor(projectId?: string | null, threadId?: string | null): Promise<MemoryDoctorResult> {
    return this.sync.doctor(this.sync.resolveScope(projectId, threadId));
  }

  async healthCheck(projectId?: string | null, threadId?: string | null): Promise<MemoryHealthReport> {
    return this.sync.healthCheck(this.sync.resolveScope(projectId, threadId));
  }

  async save(params: {
    projectId?: string | null;
    threadId?: string | null;
    path: string;
    content: string;
    mode?: 'overwrite' | 'append';
  }): Promise<{ savedPath: string; bytesWritten: number }> {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    return this.content.save(scope, { path: params.path, content: params.content, mode: params.mode });
  }

  async search(params: ServiceSearchParams): Promise<MemorySearchHit[]> {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    return this.sync.search(scope, params);
  }

  async searchCode(params: CodeSearchParams): Promise<CodeSearchHit[]> {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    return this.sync.searchCode(scope, params);
  }

  async get(params: {
    projectId?: string | null;
    threadId?: string | null;
    entryId?: string;
    path?: string;
    skipExpansion?: boolean;
  }): Promise<MemoryEntryRecord | null> {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    return this.content.get(scope, { entryId: params.entryId, path: params.path, skipExpansion: params.skipExpansion });
  }

  listChunks(params: {
    projectId?: string | null;
    threadId?: string | null;
    source?: 'all' | 'memory' | 'sessions' | 'code';
    page: number;
    pageSize: number;
  }): MemoryListResult {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    return this.content.listChunks(scope, { source: params.source, page: params.page, pageSize: params.pageSize });
  }

  deleteChunk(params: { projectId?: string | null; threadId?: string | null; chunkId: string }): void {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    this.content.deleteChunk(scope, params.chunkId);
  }

  deleteFile(params: { projectId?: string | null; threadId?: string | null; path: string }): void {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    this.content.deleteFile(scope, params.path);
  }

  updateChunk(params: { projectId?: string | null; threadId?: string | null; chunkId: string; text: string }): void {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    this.content.updateChunk(scope, params.chunkId, params.text);
  }

  pinChunk(params: { projectId?: string | null; threadId?: string | null; chunkId: string; pinned: boolean }): void {
    const scope = this.sync.resolveScope(params.projectId, params.threadId);
    this.content.pinChunk(scope, params.chunkId, params.pinned);
  }

  getThreadChunks(threadId: string, limit = 5): MemoryThreadChunk[] {
    try {
      const scope = this.sync.resolveScope(undefined, threadId);
      return this.stats.getThreadChunks(scope.projectId, threadId, limit);
    } catch {
      return [];
    }
  }

  getGlobalExpansionCounts(): { thisWeek: number; lastWeek: number } {
    return this.stats.getGlobalExpansionCounts();
  }

  getProjectStats(projectId: string): MemoryProjectStats {
    return this.stats.getProjectStats(projectId);
  }

  invalidateProject(projectId: string): void {
    closeProjectDb(projectId);
    this.sync.clearProject(projectId);
    this.stats.invalidate(projectId);
  }

  private clearDataTransaction(
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
        // graph: clear all graph tables including the FTS shadow table
        db.prepare('DELETE FROM observations_fts').run();
        db.prepare('DELETE FROM observations').run();
        db.prepare('DELETE FROM edges').run();
        cleared = db.prepare('DELETE FROM entities').run().changes; // entity_chunks cascades from entities
      }
    })();
    return cleared;
  }

  resetEmbeddings(projectId: string, target: 'memory' | 'sessions' | 'code' | 'graph'): { cleared: number } {
    const db = getProjectDb(projectId);
    const hasVecTable = checkVecTable(db);
    const cleared = this.clearDataTransaction(db, hasVecTable, target);
    this.sync.clearProject(projectId);
    this.stats.invalidate(projectId);
    const scope = this.sync.resolveScope(projectId, null);
    // graph reset re-syncs memory so the graph gets rebuilt from existing chunks
    const reembedTarget = target === 'code' ? 'code' : 'memory';
    this.sync.scheduleReembed(scope, reembedTarget);
    return { cleared };
  }

  deleteData(projectId: string, target: 'memory' | 'sessions' | 'code' | 'graph'): { cleared: number } {
    const db = getProjectDb(projectId);
    const hasVecTable = checkVecTable(db);
    const cleared = this.clearDataTransaction(db, hasVecTable, target);
    this.sync.clearProject(projectId);
    this.stats.invalidate(projectId);
    return { cleared };
  }
}

export const agentOSMemoryService = new AgentOSMemoryService();
