import type { Database } from 'better-sqlite3';
import {
  assertEntityWithObservation,
  parseJsonArray,
  entityId,
  edgeId,
  type EntityType,
  type EdgeRelation,
} from './core';
import { markMerkleRootDirty } from '../integrity';

export function linkEntities(
  db: Database,
  projectId: string,
  params: {
    chunkId?: string;
    entities?: Array<{ name: string; type: EntityType; observation?: string }>;
    edges?: Array<{ from: string; to: string; relation: EdgeRelation }>;
  }
): void {
  const now = Date.now();
  const { chunkId } = params;

  const selectEdge = db.prepare<[string]>('SELECT id FROM edges WHERE id = ?');
  const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO edges (id, project_id, from_id, to_id, relation, weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const updateEdgeWeight = db.prepare('UPDATE edges SET weight = weight + 1 WHERE id = ?');
  const selectByName = db.prepare<[string, string]>('SELECT id FROM entities WHERE project_id = ? AND name = ?');
  const selectEntity = db.prepare<[string]>('SELECT id, chunk_ids FROM entities WHERE id = ?');
  const insertEntity = db.prepare(
    'INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const updateChunkIds = db.prepare('UPDATE entities SET chunk_ids = ?, updated_at = ? WHERE id = ?');
  const insertEntityChunk = db.prepare('INSERT OR IGNORE INTO entity_chunks (entity_id, chunk_id) VALUES (?, ?)');

  db.transaction(() => {
    for (const { name, type, observation } of params.entities ?? []) {
      if (observation) {
        assertEntityWithObservation(db, projectId, name, type, observation, chunkId, {
          now,
          stmts: { selectEntity, updateChunkIds, insertEntity, insertEntityChunk },
        });
      } else {
        const id = entityId(projectId, name, type);
        const existing = selectEntity.get(id) as { id: string; chunk_ids: string } | undefined;
        if (existing) {
          if (chunkId) {
            const ids = parseJsonArray(existing.chunk_ids);
            if (!ids.includes(chunkId)) {
              updateChunkIds.run(JSON.stringify([...ids, chunkId]), now, id);
              insertEntityChunk.run(id, chunkId);
            }
          }
        } else {
          insertEntity.run(id, projectId, name, type, '[]', JSON.stringify(chunkId ? [chunkId] : []), now, now);
          if (chunkId) insertEntityChunk.run(id, chunkId);
        }
      }
    }

    // Upsert edges — resolve entity names to IDs
    const resolveId = (name: string): string | null => {
      const row = selectByName.get(projectId, name) as { id: string } | undefined;
      return row?.id ?? null;
    };

    for (const { from, to, relation } of params.edges ?? []) {
      if (from === to) continue;
      const fromId = resolveId(from);
      const toId = resolveId(to);
      if (!fromId || !toId || fromId === toId) continue;
      const id = edgeId(projectId, fromId, toId, relation);
      if (selectEdge.get(id)) {
        updateEdgeWeight.run(id);
      } else {
        insertEdge.run(id, projectId, fromId, toId, relation, 1.0, chunkId ?? 'manual', now);
      }
    }
  })();
  markMerkleRootDirty(db, projectId);
}

export function addObservation(
  db: Database,
  projectId: string,
  params: {
    entityName: string;
    entityType: EntityType;
    observation: string;
    sourceChunkId?: string;
  }
): void {
  assertEntityWithObservation(
    db,
    projectId,
    params.entityName,
    params.entityType,
    params.observation,
    params.sourceChunkId
  );
  markMerkleRootDirty(db, projectId);
}
