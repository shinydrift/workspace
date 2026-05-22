import type { Database, Statement } from 'better-sqlite3';
import { assertObservation } from '../observationService';
import { hashText } from '../utils';
import { extractKeywords } from '../search/queryExpansion';

// ── Types ──────────────────────────────────────────────────────────────────────

export type EntityType = 'file' | 'symbol' | 'issue' | 'decision' | 'person' | 'concept' | (string & {});
export type EdgeRelation = 'related_to' | 'fixes' | 'modifies' | 'depends_on';

export interface EntityNode {
  id: string;
  projectId: string;
  name: string;
  type: EntityType;
  aliases: string[];
  chunkIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EdgeRecord {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  relation: EdgeRelation;
  weight: number;
  source: string;
  createdAt: number;
}

export interface GraphQueryResult {
  nodes: EntityNode[];
  edges: EdgeRecord[];
  total: number;
}

// Shared DB row shape for entities
interface EntityRow {
  id: string;
  project_id: string;
  name: string;
  type: string;
  aliases: string;
  chunk_ids: string;
  created_at: number;
  updated_at: number;
  content_hash?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function entityId(projectId: string, name: string, type: EntityType): string {
  return hashText(`${projectId}:${type}:${name}`);
}

export function edgeId(projectId: string, fromId: string, toId: string, relation: EdgeRelation): string {
  return hashText(`${projectId}:${fromId}:${toId}:${relation}`);
}

export type EntityUpsertStmts = {
  selectEntity: Statement;
  updateChunkIds: Statement;
  insertEntity: Statement;
  insertEntityChunk: Statement;
};

/** Upsert an entity and atomically attach an observation to it. */
export function assertEntityWithObservation(
  db: Database,
  projectId: string,
  name: string,
  type: EntityType,
  observation: string,
  chunkId?: string | null,
  opts?: { now?: number; stmts?: EntityUpsertStmts }
): void {
  const now = opts?.now ?? Date.now();
  const id = entityId(projectId, name, type);
  const selectEntity =
    opts?.stmts?.selectEntity ?? db.prepare<[string]>('SELECT id, chunk_ids FROM entities WHERE id = ?');
  const updateChunkIds =
    opts?.stmts?.updateChunkIds ?? db.prepare('UPDATE entities SET chunk_ids = ?, updated_at = ? WHERE id = ?');
  const insertEntity =
    opts?.stmts?.insertEntity ??
    db.prepare(
      'INSERT INTO entities (id, project_id, name, type, aliases, chunk_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
  const insertEntityChunk =
    opts?.stmts?.insertEntityChunk ??
    db.prepare('INSERT OR IGNORE INTO entity_chunks (entity_id, chunk_id) VALUES (?, ?)');
  db.transaction(() => {
    const existing = selectEntity.get(id) as { id: string; chunk_ids: string } | undefined;
    if (existing) {
      if (chunkId) {
        const ids: string[] = parseJsonArray(existing.chunk_ids);
        if (!ids.includes(chunkId)) {
          updateChunkIds.run(JSON.stringify([...ids, chunkId]), now, id);
          insertEntityChunk.run(id, chunkId);
        }
      }
    } else {
      insertEntity.run(id, projectId, name, type, '[]', JSON.stringify(chunkId ? [chunkId] : []), now, now);
      if (chunkId) insertEntityChunk.run(id, chunkId);
    }
    assertObservation(db, id, observation, projectId, chunkId);
  })();
  // Runs outside the transaction: a crash here leaves content_hash stale but the Merkle root
  // dirty flag ensures verifyIntegrity() returns false until the next sync recomputes it.
  propagateContentHash(db, id, projectId);
}

export function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function rowToNode(row: EntityRow): EntityNode {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type as EntityType,
    aliases: parseJsonArray(row.aliases),
    chunkIds: parseJsonArray(row.chunk_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Merkle hashing ────────────────────────────────────────────────────────────

/**
 * Compute a content hash for an entity from its fields + sorted observation texts
 * + content_hashes of non-null direct children.
 * `visited` guards against cyclic edges — callers should pass a fresh empty Set.
 */
export function computeEntityContentHash(
  db: Database,
  entityId_: string,
  projectId: string,
  visited: Set<string> = new Set()
): string | null {
  if (visited.has(entityId_)) return null;
  visited.add(entityId_);

  const entity = db.prepare('SELECT name, type, aliases FROM entities WHERE id = ?').get(entityId_) as
    | Pick<EntityRow, 'name' | 'type' | 'aliases'>
    | undefined;
  if (!entity) return null;

  const obsRows = db
    .prepare('SELECT text FROM observations WHERE entity_id = ? AND project_id = ? ORDER BY text ASC')
    .all(entityId_, projectId) as { text: string }[];
  const obsList = obsRows.map((r) => r.text).sort();

  const childEdges = db
    .prepare('SELECT to_id FROM edges WHERE project_id = ? AND from_id = ?')
    .all(projectId, entityId_) as { to_id: string }[];
  const childHashes: string[] = [];
  for (const { to_id } of childEdges) {
    const childRow = db.prepare('SELECT content_hash FROM entities WHERE id = ?').get(to_id) as
      | { content_hash: string | null }
      | undefined;
    if (childRow?.content_hash != null) {
      childHashes.push(childRow.content_hash);
    }
  }
  childHashes.sort();

  const input = JSON.stringify({
    name: entity.name,
    type: entity.type,
    aliases: entity.aliases,
    observations: obsList,
    childHashes,
  });
  return hashText(input);
}

/**
 * Recompute content_hash for `startEntityId` and propagate upward via inbound edges,
 * up to MAX_HOPS. Ancestors beyond MAX_HOPS are marked content_hash = NULL (dirty).
 * Uses a cycle-safe `updated` set to avoid revisiting nodes within a single propagation pass.
 */
export function propagateContentHash(db: Database, startEntityId: string, projectId: string): void {
  const MAX_HOPS = 3;
  const updated = new Set<string>();

  function updateEntity(eid: string, hop: number): void {
    if (updated.has(eid)) return;
    updated.add(eid);

    if (hop > MAX_HOPS) {
      db.prepare('UPDATE entities SET content_hash = NULL WHERE id = ?').run(eid);
      return;
    }

    const hash = computeEntityContentHash(db, eid, projectId, new Set<string>());
    if (hash !== null) {
      db.prepare('UPDATE entities SET content_hash = ? WHERE id = ?').run(hash, eid);
    }

    const parents = db.prepare('SELECT from_id FROM edges WHERE project_id = ? AND to_id = ?').all(projectId, eid) as {
      from_id: string;
    }[];
    for (const { from_id } of parents) {
      updateEntity(from_id, hop + 1);
    }
  }

  updateEntity(startEntityId, 0);
}

// ── Graph Query Engine ─────────────────────────────────────────────────────────

export class GraphQueryEngine {
  /**
   * Expand search context: given a query text and top chunk IDs,
   * find entity mentions in the query, traverse the graph, and return
   * additional chunk IDs to boost.
   */
  static expandContext(db: Database, projectId: string, queryText: string, topChunkIds: string[]): Map<string, number> {
    const result = new Map<string, number>();
    const topChunkSet = new Set(topChunkIds);

    // Extract meaningful keywords from the query for entity name matching (LLM-registered entities)
    const queryKeywords = extractKeywords(queryText).slice(0, 5);

    if (queryKeywords.length === 0 && topChunkIds.length === 0) return result;

    // Seed from entities whose names contain meaningful query keywords (cap at 5 per keyword to avoid explosion)
    const seedEntityIds = new Set<string>();
    const entityByLike = db.prepare<[string, string]>('SELECT id FROM entities WHERE project_id = ? AND name LIKE ?');
    for (const keyword of queryKeywords) {
      const rows = entityByLike.all(projectId, `%${keyword}%`) as { id: string }[];
      for (const row of rows.slice(0, 5)) seedEntityIds.add(row.id);
    }

    // Also seed from entities associated with top chunks (via join table — avoids json_each full scan)
    const entityByChunk = db.prepare<[string, string]>(
      `SELECT ec.entity_id AS id FROM entity_chunks ec
       JOIN entities e ON e.id = ec.entity_id
       WHERE e.project_id = ? AND ec.chunk_id = ?`
    );
    for (const chunkId of topChunkIds) {
      const rows = entityByChunk.all(projectId, chunkId) as { id: string }[];
      for (const row of rows) seedEntityIds.add(row.id);
    }

    if (seedEntityIds.size === 0) return result;

    // BFS traversal up to 2 hops, tracking hop distance per entity.
    // UNION lets SQLite use idx_edges_from and idx_edges_to independently.
    const entityHop = new Map<string, number>();
    for (const eid of seedEntityIds) entityHop.set(eid, 0);
    const visited = new Set<string>(seedEntityIds);
    let frontier = [...seedEntityIds];
    const neighborsStmt = db.prepare<[string, string, string, string]>(
      `SELECT to_id   AS neighbor_id FROM edges WHERE project_id = ? AND from_id = ?
       UNION
       SELECT from_id AS neighbor_id FROM edges WHERE project_id = ? AND to_id   = ?`
    );
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const eid of frontier) {
        const neighbors = neighborsStmt.all(projectId, eid, projectId, eid) as { neighbor_id: string }[];
        for (const { neighbor_id } of neighbors) {
          if (!visited.has(neighbor_id)) {
            visited.add(neighbor_id);
            entityHop.set(neighbor_id, hop + 1);
            next.push(neighbor_id);
          }
        }
      }
      frontier = next;
    }

    // Collect chunk IDs from all visited entities; store minimum hop distance per chunk.
    const chunkStmt = db.prepare<[string]>('SELECT chunk_id FROM entity_chunks WHERE entity_id = ?');
    for (const [eid, hop] of entityHop) {
      const rows = chunkStmt.all(eid) as { chunk_id: string }[];
      for (const { chunk_id } of rows) {
        if (!topChunkSet.has(chunk_id)) {
          const existing = result.get(chunk_id);
          if (existing === undefined || hop < existing) result.set(chunk_id, hop);
        }
      }
    }

    return result;
  }

  /**
   * Return one page of entities + edges where either endpoint is in the page.
   * Caller accumulates pages; edges referencing unloaded nodes should be deferred.
   * total is populated only on offset=0 to avoid a redundant COUNT on every page.
   */
  static graphAllPage(
    db: Database,
    projectId: string,
    offset: number,
    limit: number
  ): { nodes: EntityNode[]; edges: EdgeRecord[]; total: number; hasMore: boolean } {
    const total =
      offset === 0
        ? (
            db.prepare<[string]>('SELECT COUNT(*) as n FROM entities WHERE project_id = ?').get(projectId) as {
              n: number;
            }
          ).n
        : 0;

    const nodes = (
      db
        .prepare<
          [string, number, number]
        >('SELECT * FROM entities WHERE project_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
        .all(projectId, limit, offset) as EntityRow[]
    ).map(rowToNode);

    if (nodes.length === 0) return { nodes, edges: [], total, hasMore: false };

    const nodeIds = nodes.map((n) => n.id);
    const placeholders = nodeIds.map(() => '?').join(', ');
    // UNION lets SQLite use idx_edges_from and idx_edges_to independently
    const edgeRows = db
      .prepare(
        `SELECT * FROM edges WHERE project_id = ? AND from_id IN (${placeholders})
         UNION
         SELECT * FROM edges WHERE project_id = ? AND to_id   IN (${placeholders})`
      )
      .all(projectId, ...nodeIds, projectId, ...nodeIds) as {
      id: string;
      project_id: string;
      from_id: string;
      to_id: string;
      relation: string;
      weight: number;
      source: string;
      created_at: number;
    }[];

    const edges: EdgeRecord[] = edgeRows.map((e) => ({
      id: e.id,
      projectId: e.project_id,
      fromId: e.from_id,
      toId: e.to_id,
      relation: e.relation as EdgeRelation,
      weight: e.weight,
      source: e.source,
      createdAt: e.created_at,
    }));

    // On offset=0 we have exact total; on later pages fall back to nodes.length===limit
    return { nodes, edges, total, hasMore: offset === 0 ? offset + nodes.length < total : nodes.length === limit };
  }

  /**
   * Return all entities and their edges up to topK nodes.
   */
  static graphAll(db: Database, projectId: string, topK = 2000): GraphQueryResult {
    const total = (
      db.prepare<[string]>('SELECT COUNT(*) as n FROM entities WHERE project_id = ?').get(projectId) as {
        n: number;
      }
    ).n;

    const nodes = (
      db
        .prepare<[string, number]>('SELECT * FROM entities WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(projectId, topK) as EntityRow[]
    ).map(rowToNode);

    if (nodes.length === 0) return { nodes, edges: [], total };

    const nodeIds = nodes.map((n) => n.id);
    const placeholders = nodeIds.map(() => '?').join(', ');
    const edgeRows = db
      .prepare(
        `SELECT * FROM edges
       WHERE project_id = ?
         AND from_id IN (${placeholders})
         AND to_id IN (${placeholders})
       ORDER BY weight DESC`
      )
      .all(projectId, ...nodeIds, ...nodeIds) as {
      id: string;
      project_id: string;
      from_id: string;
      to_id: string;
      relation: string;
      weight: number;
      source: string;
      created_at: number;
    }[];

    const edges: EdgeRecord[] = edgeRows.map((e) => ({
      id: e.id,
      projectId: e.project_id,
      fromId: e.from_id,
      toId: e.to_id,
      relation: e.relation as EdgeRelation,
      weight: e.weight,
      source: e.source,
      createdAt: e.created_at,
    }));

    return { nodes, edges, total };
  }

  /**
   * Query the graph for a named entity and return connected nodes + edges up to maxHops.
   */
  static graphQuery(
    db: Database,
    projectId: string,
    entityName: string,
    options: { maxHops?: number; relationTypes?: EdgeRelation[]; topK?: number } = {}
  ): GraphQueryResult {
    const { maxHops = 2, relationTypes, topK = 50 } = options;

    // Find the root entity (case-insensitive partial match)
    const root = db
      .prepare<[string, string]>('SELECT * FROM entities WHERE project_id = ? AND name LIKE ? LIMIT 1')
      .get(projectId, `%${entityName}%`) as EntityRow | undefined;

    if (!root) return { nodes: [], edges: [], total: 0 };

    const nodeMap = new Map<string, EntityNode>();
    const edgeMap = new Map<string, EdgeRecord>();

    nodeMap.set(root.id, rowToNode(root));

    // Pre-prepare statements for BFS (outside the hop/frontier loops)
    const selectEntityStmt = db.prepare<[string]>('SELECT * FROM entities WHERE id = ?');
    const hasRelTypes = (relationTypes?.length ?? 0) > 0;
    const relClause = hasRelTypes ? ` AND relation IN (${relationTypes!.map(() => '?').join(',')})` : '';
    const relArgs: unknown[] = hasRelTypes ? (relationTypes as unknown[]) : [];
    // UNION ALL lets SQLite use idx_edges_from and idx_edges_to independently
    const edgeQuery =
      `SELECT * FROM edges WHERE project_id = ? AND from_id = ?${relClause}` +
      ` UNION ALL` +
      ` SELECT * FROM edges WHERE project_id = ? AND to_id   = ?${relClause}`;
    const edgeStmt = db.prepare(edgeQuery);

    let frontier = [root.id];
    for (let hop = 0; hop < maxHops; hop++) {
      const next: string[] = [];
      for (const eid of frontier) {
        // Check topK before processing this frontier node
        if (nodeMap.size >= topK) break;

        const args: unknown[] = [projectId, eid, ...relArgs, projectId, eid, ...relArgs];
        const edges = edgeStmt.all(...args) as {
          id: string;
          project_id: string;
          from_id: string;
          to_id: string;
          relation: string;
          weight: number;
          source: string;
          created_at: number;
        }[];

        for (const e of edges) {
          if (!edgeMap.has(e.id)) {
            edgeMap.set(e.id, {
              id: e.id,
              projectId: e.project_id,
              fromId: e.from_id,
              toId: e.to_id,
              relation: e.relation as EdgeRelation,
              weight: e.weight,
              source: e.source,
              createdAt: e.created_at,
            });
          }
          const neighborId = e.from_id === eid ? e.to_id : e.from_id;
          if (!nodeMap.has(neighborId)) {
            const neighborRow = selectEntityStmt.get(neighborId) as EntityRow | undefined;
            if (neighborRow) {
              nodeMap.set(neighborId, rowToNode(neighborRow));
              next.push(neighborId);
            }
          }
        }
      }
      frontier = next;
      if (frontier.length === 0 || nodeMap.size >= topK) break;
    }

    return {
      nodes: [...nodeMap.values()],
      edges: [...edgeMap.values()],
      total: nodeMap.size,
    };
  }
}
