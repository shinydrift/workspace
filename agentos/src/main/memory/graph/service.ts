import type { SyncScope } from '../sync/core';
import { getProjectDb } from '../projectDb';
import {
  GraphQueryEngine,
  type EntityType,
  type EntityNode,
  type EdgeRecord,
  type GraphQueryResult,
  type EdgeRelation,
} from './core';
import { linkEntities as graphLinkEntities, addObservation as graphAddObservation } from './ops';

export class MemoryGraphService {
  linkEntities(
    scope: SyncScope,
    params: {
      chunkId?: string;
      entities?: Array<{ name: string; type: EntityType; observation?: string }>;
      edges?: Array<{ from: string; to: string; relation: EdgeRelation }>;
    }
  ): void {
    graphLinkEntities(getProjectDb(scope.projectId), scope.projectId, params);
  }

  addObservation(
    scope: SyncScope,
    params: {
      entityName: string;
      entityType: EntityType;
      observation: string;
      sourceChunkId?: string;
    }
  ): void {
    graphAddObservation(getProjectDb(scope.projectId), scope.projectId, params);
  }

  graphAll(scope: SyncScope, topK: number): GraphQueryResult {
    return GraphQueryEngine.graphAll(getProjectDb(scope.projectId), scope.projectId, topK);
  }

  graphAllPage(
    scope: SyncScope,
    offset: number,
    limit: number
  ): { nodes: EntityNode[]; edges: EdgeRecord[]; total: number; hasMore: boolean } {
    return GraphQueryEngine.graphAllPage(getProjectDb(scope.projectId), scope.projectId, offset, limit);
  }

  async graphQuery(
    scope: SyncScope,
    entityName: string,
    options: { maxHops?: number; relationTypes?: EdgeRelation[]; topK?: number } = {}
  ): Promise<GraphQueryResult> {
    return GraphQueryEngine.graphQuery(getProjectDb(scope.projectId), scope.projectId, entityName, options);
  }

  getEntityChunks(projectId: string, entityId: string): string[] {
    const db = getProjectDb(projectId);
    const rows = db.prepare<[string]>('SELECT chunk_id FROM entity_chunks WHERE entity_id = ?').all(entityId) as {
      chunk_id: string;
    }[];
    return rows.map((r) => r.chunk_id);
  }
}
