import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import type { MemorySearchHit, CodeSearchHit, AppSettings } from '../../../shared/types';
import { createSnippet } from '../utils';
import { buildFtsQuery, mergeHybridResults, type VectorRow, type KeywordRow } from './hybrid';
import { applyDecay, type TemporalDecayConfig } from './temporalDecay';
import { mmrRerank } from './mmr';
import type { EmbeddingProvider } from '../embedding/provider';
import type { SyncScope } from '../sync/core';
import { checkVecTable } from '../db';
import { GraphQueryEngine } from '../graph/core';
import { searchObservations } from '../observationService';

const DEFAULT_MAX_RESULTS = 8;

// Cache per-project config to avoid synchronous file reads on every search (30 s TTL)
interface ProjectMemCfg {
  decayEnabled: boolean;
  halfLifeDays: number;
  decayMinScore: number;
  graphEnabled: boolean;
  graphBoost: number;
  obsWeight: number;
  // Search tuning overrides — undefined means fall back to AppSettings
  maxResults?: number;
  minScore?: number;
  vectorWeight?: number;
  textWeight?: number;
  mmrLambda?: number;
  sessionRetentionDays?: number;
  codeVectorWeight?: number;
  codeTextWeight?: number;
  codeDecayHalfLifeDays?: number;
}

const CFG_DEFAULTS: Omit<ProjectMemCfg, 'halfLifeDays'> = {
  decayEnabled: true,
  decayMinScore: 0,
  graphEnabled: true,
  graphBoost: 0.15,
  obsWeight: 0.15,
};

const OBS_CAP = 0.2;
const HOP_MULTIPLIERS = [1.0, 0.6, 0.3]; // hop 0 (seed-entity chunks), 1, 2
const OBS_GRAPH_MULTIPLIER = 0.5; // obs-entity chunks already received an obs boost

const projectCfgCache = new Map<string, { cfg: ProjectMemCfg; expiresAt: number }>();
const CFG_CACHE_TTL_MS = 30_000;
const CFG_CACHE_MAX = 100; // upper bound on concurrent projects; each entry ≈ 100 bytes

const lastPrunedAt = new Map<string, number>();
const PRUNE_INTERVAL_MS = 3_600_000;

function loadProjectMemCfg(projectPath: string, defaultHalfLife: number): ProjectMemCfg {
  const cached = projectCfgCache.get(projectPath);
  if (cached && Date.now() < cached.expiresAt) {
    projectCfgCache.delete(projectPath);
    projectCfgCache.set(projectPath, cached);
    return cached.cfg;
  }

  const cfg: ProjectMemCfg = { ...CFG_DEFAULTS, halfLifeDays: defaultHalfLife };
  try {
    const cfgPath = path.join(projectPath, '.agentos', 'config.json');
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    const mem = raw?.memory as Record<string, unknown> | undefined;
    if (mem) {
      if (typeof mem.decayEnabled === 'boolean') cfg.decayEnabled = mem.decayEnabled;
      if (typeof mem.decayHalfLifeDays === 'number') cfg.halfLifeDays = mem.decayHalfLifeDays;
      if (typeof mem.decayMinScore === 'number') cfg.decayMinScore = mem.decayMinScore;
      if (typeof mem.graphEnabled === 'boolean') cfg.graphEnabled = mem.graphEnabled;
      if (typeof mem.graphBoost === 'number') cfg.graphBoost = mem.graphBoost;
      if (typeof mem.obsWeight === 'number') cfg.obsWeight = mem.obsWeight;
      if (typeof mem.maxResults === 'number') cfg.maxResults = mem.maxResults;
      if (typeof mem.minScore === 'number') cfg.minScore = mem.minScore;
      if (typeof mem.vectorWeight === 'number') cfg.vectorWeight = mem.vectorWeight;
      if (typeof mem.textWeight === 'number') cfg.textWeight = mem.textWeight;
      if (typeof mem.mmrLambda === 'number') cfg.mmrLambda = mem.mmrLambda;
      if (typeof mem.sessionRetentionDays === 'number') cfg.sessionRetentionDays = mem.sessionRetentionDays;
      if (typeof mem.codeVectorWeight === 'number') cfg.codeVectorWeight = mem.codeVectorWeight;
      if (typeof mem.codeTextWeight === 'number') cfg.codeTextWeight = mem.codeTextWeight;
      if (typeof mem.codeDecayHalfLifeDays === 'number') cfg.codeDecayHalfLifeDays = mem.codeDecayHalfLifeDays;
    }
  } catch {
    /* no config or invalid JSON — use defaults */
  }
  // Evict oldest entry if cache is at capacity
  if (projectCfgCache.size >= CFG_CACHE_MAX) {
    projectCfgCache.delete(projectCfgCache.keys().next().value!);
  }
  projectCfgCache.set(projectPath, { cfg, expiresAt: Date.now() + CFG_CACHE_TTL_MS });
  return cfg;
}

type SearchParams = {
  projectId?: string | null;
  threadId?: string | null;
  query: string;
  maxResults?: number;
  minScore?: number;
  source?: 'all' | 'memory' | 'sessions';
};

export type { SearchParams };

export function invalidateProjectCfgCache(projectPath: string): void {
  projectCfgCache.delete(projectPath);
}

export function clearAllProjectCfgCaches(): void {
  projectCfgCache.clear();
}

export function pruneOldSessions(db: Database, scope: SyncScope, settings: AppSettings): void {
  const ms = settings.memory ?? {};
  const projCfg = scope.projectPath ? loadProjectMemCfg(scope.projectPath, ms.decayHalfLifeDays ?? 45) : null;
  const retentionDays = projCfg?.sessionRetentionDays ?? ms.sessionRetentionDays ?? 90;
  if (!retentionDays || retentionDays <= 0) return;
  const now = Date.now();
  const lastPruned = lastPrunedAt.get(scope.projectId) ?? 0;
  if (now - lastPruned < PRUNE_INTERVAL_MS) return;
  lastPrunedAt.set(scope.projectId, now);
  const cutoff = now - retentionDays * 86_400_000;
  const hasVecTable = checkVecTable(db);
  // Use subqueries instead of IN (?,?,...) to avoid SQLite's 999-variable limit
  db.prepare(
    "DELETE FROM observations_fts WHERE id IN (SELECT o.id FROM observations o WHERE o.source_chunk_id IN (SELECT id FROM chunks WHERE source = 'sessions' AND updated_at < ?))"
  ).run(cutoff);
  db.prepare(
    "DELETE FROM observations WHERE source_chunk_id IN (SELECT id FROM chunks WHERE source = 'sessions' AND updated_at < ?)"
  ).run(cutoff);
  db.prepare(
    "DELETE FROM chunk_expansions WHERE chunk_id IN (SELECT id FROM chunks WHERE source = 'sessions' AND updated_at < ?)"
  ).run(cutoff);
  db.prepare(
    "DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE source = 'sessions' AND updated_at < ?)"
  ).run(cutoff);
  if (hasVecTable) {
    db.prepare(
      "DELETE FROM chunks_vec WHERE id IN (SELECT id FROM chunks WHERE source = 'sessions' AND updated_at < ?)"
    ).run(cutoff);
  }
  db.prepare("DELETE FROM chunks WHERE source = 'sessions' AND updated_at < ?").run(cutoff);
  db.prepare("DELETE FROM files  WHERE source = 'sessions' AND mtime    < ?").run(cutoff);
  // Prune all stale expansion records (not just sessions) so the scoring map stays bounded
  db.prepare('DELETE FROM chunk_expansions WHERE expanded_at < ?').run(cutoff);
}

const PROJECT_CLAUSE = ' AND EXISTS (SELECT 1 FROM json_each(c.project_ids) WHERE value = ?)';

async function buildHybridResults(
  db: Database,
  query: string,
  srcClause: string,
  srcArgs: string[],
  projectArg: string,
  limitN: number,
  provider: EmbeddingProvider | null,
  hasVecTable: boolean,
  vectorWeight: number,
  textWeight: number
): Promise<{ merged: ReturnType<typeof mergeHybridResults>; queryVec: number[] | null }> {
  const expansionCounts = new Map<string, number>(
    (
      db.prepare('SELECT chunk_id, COUNT(*) AS cnt FROM chunk_expansions GROUP BY chunk_id').all() as Array<{
        chunk_id: string;
        cnt: number;
      }>
    ).map((r) => [r.chunk_id, r.cnt])
  );

  let merged: ReturnType<typeof mergeHybridResults> = [];
  let queryVec: number[] | null = null;

  if (provider && hasVecTable) {
    try {
      queryVec = await provider.embedQuery(query);
    } catch {
      /* fall through to FTS */
    }

    if (queryVec && queryVec.length > 0) {
      const knnLimit = limitN * 3;
      const queryBuf = Buffer.from(new Float32Array(queryVec).buffer);
      const vecRows = db
        .prepare(
          `WITH knn AS (
             SELECT id, vec_distance_cosine(embedding, vec_f32(?)) AS dist
             FROM chunks_vec
             WHERE embedding MATCH vec_f32(?) AND k = ?
           )
           SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.text, c.model, c.updated_at, c.pinned,
                  knn.dist
           FROM knn
           JOIN chunks c ON c.id = knn.id
           WHERE c.model = ?${srcClause}${PROJECT_CLAUSE}
           ORDER BY knn.dist ASC
           LIMIT ?`
        )
        .all(queryBuf, queryBuf, knnLimit, provider.model, ...srcArgs, projectArg, limitN) as VectorRow[];

      const ftsQ = buildFtsQuery(query);
      const kwSql = `SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.text, c.model, c.updated_at, c.pinned,
                -bm25(chunks_fts) AS bm25_rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.id
         WHERE chunks_fts MATCH ? AND c.model = ?${srcClause}${PROJECT_CLAUSE}
         ORDER BY bm25_rank ASC LIMIT ?`;
      let kwRows: KeywordRow[] = ftsQ
        ? (db.prepare(kwSql).all(ftsQ, provider.model, ...srcArgs, projectArg, limitN) as KeywordRow[])
        : [];

      const ftsQOr = ftsQ ? buildFtsQuery(query, true) : null;
      if (kwRows.length === 0 && ftsQOr && ftsQOr !== ftsQ) {
        kwRows = db.prepare(kwSql).all(ftsQOr, provider.model, ...srcArgs, projectArg, limitN) as KeywordRow[];
      }

      merged = mergeHybridResults({ vector: vecRows, keyword: kwRows, vectorWeight, textWeight, expansionCounts });
    }
  }

  if (merged.length === 0) {
    const ftsQ = buildFtsQuery(query);
    if (!ftsQ) return { merged: [], queryVec: null };
    const modelClause = provider ? ' AND c.model = ?' : '';
    const modelArgs = provider ? [provider.model] : [];
    const ftsOnlySql = `SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.text, c.model, c.updated_at, c.pinned,
              -bm25(chunks_fts) AS bm25_rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.id
       WHERE chunks_fts MATCH ?${modelClause}${srcClause}${PROJECT_CLAUSE}
       ORDER BY bm25_rank ASC LIMIT ?`;
    let kwRows = db.prepare(ftsOnlySql).all(ftsQ, ...modelArgs, ...srcArgs, projectArg, limitN) as KeywordRow[];
    const ftsQOr = buildFtsQuery(query, true);
    if (kwRows.length === 0 && ftsQOr && ftsQOr !== ftsQ) {
      kwRows = db.prepare(ftsOnlySql).all(ftsQOr, ...modelArgs, ...srcArgs, projectArg, limitN) as KeywordRow[];
    }
    merged = mergeHybridResults({ vector: [], keyword: kwRows, vectorWeight: 0, textWeight: 1, expansionCounts });
  }

  return { merged, queryVec };
}

function buildEntityMap(
  db: Database,
  projectId: string,
  topIds: string[]
): Map<string, Array<{ name: string; type: string; observations: string[] }>> {
  const entityMap = new Map<string, Array<{ name: string; type: string; observations: string[] }>>();
  if (topIds.length === 0) return entityMap;

  const placeholders = topIds.map(() => '?').join(', ');
  const entityRows = db
    .prepare(
      `SELECT e.id, e.name, e.type, ec.chunk_id
       FROM entities e
       JOIN entity_chunks ec ON ec.entity_id = e.id
       WHERE e.project_id = ? AND ec.chunk_id IN (${placeholders})`
    )
    .all(projectId, ...topIds) as Array<{ id: string; name: string; type: string; chunk_id: string }>;

  const entityIds = [...new Set(entityRows.map((r) => r.id))];
  const obsMap = new Map<string, string[]>();
  if (entityIds.length > 0) {
    const obsPlaceholders = entityIds.map(() => '?').join(', ');
    const obsRows = db
      .prepare(`SELECT entity_id, text FROM observations WHERE project_id = ? AND entity_id IN (${obsPlaceholders})`)
      .all(projectId, ...entityIds) as Array<{ entity_id: string; text: string }>;
    for (const o of obsRows) {
      if (!obsMap.has(o.entity_id)) obsMap.set(o.entity_id, []);
      obsMap.get(o.entity_id)!.push(o.text);
    }
  }

  for (const row of entityRows) {
    if (!entityMap.has(row.chunk_id)) entityMap.set(row.chunk_id, []);
    entityMap.get(row.chunk_id)!.push({ name: row.name, type: row.type, observations: obsMap.get(row.id) ?? [] });
  }

  return entityMap;
}

// Core memory search algorithm: hybrid vector+keyword search with temporal decay and MMR reranking.
// Extracted from AgentOSMemoryService.search() to keep the service class focused on coordination.
export async function searchMemory(
  scope: SyncScope,
  params: SearchParams,
  settings: AppSettings,
  provider: EmbeddingProvider | null,
  db: Database
): Promise<MemorySearchHit[]> {
  const query = params.query.trim();
  if (!query) return [];

  const ms = settings.memory ?? {};
  // Per-project config (falls back to app-level settings, cached 30 s)
  const defaultHalfLife = ms.decayHalfLifeDays ?? 45;
  const projCfg = scope.projectPath
    ? loadProjectMemCfg(scope.projectPath, defaultHalfLife)
    : { ...CFG_DEFAULTS, halfLifeDays: defaultHalfLife };

  const maxResults = params.maxResults ?? projCfg.maxResults ?? ms.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = params.minScore ?? projCfg.minScore ?? ms.minScore ?? 0.5;
  const vectorWeight = projCfg.vectorWeight ?? ms.vectorWeight ?? 0.7;
  const textWeight = projCfg.textWeight ?? ms.textWeight ?? 0.3;
  const mmrLambda = projCfg.mmrLambda ?? ms.mmrLambda ?? 0.7;
  const { decayEnabled, halfLifeDays, decayMinScore, graphEnabled, graphBoost, obsWeight } = projCfg;

  const hasVecTable = checkVecTable(db);

  const source = params.source ?? 'all';
  const limitN = Math.max(maxResults * 8, 64);
  const srcClause = source === 'all' ? " AND c.source IN ('memory', 'sessions')" : ' AND c.source = ?';
  const srcArgs: string[] = source === 'all' ? [] : [source];
  const projectArg = scope.projectId;

  const { merged, queryVec } = await buildHybridResults(
    db,
    query,
    srcClause,
    srcArgs,
    projectArg,
    limitN,
    provider,
    hasVecTable,
    vectorWeight,
    textWeight
  );

  // Observation reinforcement: boost candidate chunks whose linked observations match the query
  const obsHits = await searchObservations(
    db,
    scope.projectId,
    query,
    Math.ceil(limitN / 2),
    undefined,
    queryVec,
    provider
  );
  let obsBoosted = merged;
  if (obsHits.length > 0) {
    const obsBoostMap = new Map<string, number>();
    obsHits.forEach((h, i) => {
      if (h.sourceChunkId) {
        const existing = obsBoostMap.get(h.sourceChunkId) ?? 0;
        obsBoostMap.set(h.sourceChunkId, Math.min(OBS_CAP, existing + obsWeight / (1 + i)));
      }
    });
    obsBoosted = merged.map((r) => {
      const boost = obsBoostMap.get(r.id);
      if (!boost) return r;
      return { ...r, score: r.score + boost * (1 - r.score) };
    });
    obsBoosted.sort((a, b) => b.score - a.score);
  }

  // Graph boost: expand context via knowledge graph and boost related chunk scores
  let graphBoosted = obsBoosted;
  if (graphEnabled && graphBoost > 0) {
    const topIds = obsBoosted.slice(0, Math.min(5, obsBoosted.length)).map((r) => r.id);
    const entityChunkStmt = db.prepare<[string]>('SELECT chunk_id FROM entity_chunks WHERE entity_id = ?');
    const obsEntityChunkIds = obsHits.slice(0, 5).flatMap((h) => {
      const rows = entityChunkStmt.all(h.entityId) as { chunk_id: string }[];
      return rows.map((r) => r.chunk_id);
    });
    const relatedIds = GraphQueryEngine.expandContext(db, scope.projectId, query, topIds);
    for (const cid of obsEntityChunkIds) {
      if (!relatedIds.has(cid)) relatedIds.set(cid, 1);
    }
    if (relatedIds.size > 0) {
      const obsEntitySet = new Set(obsEntityChunkIds);
      graphBoosted = obsBoosted.map((r) => {
        const hop = relatedIds.get(r.id);
        if (hop === undefined) return r;
        const multiplier = (HOP_MULTIPLIERS[hop] ?? 0.3) * (obsEntitySet.has(r.id) ? OBS_GRAPH_MULTIPLIER : 1.0);
        const boost = graphBoost * multiplier;
        return { ...r, score: r.score + boost * (1 - r.score) };
      });
      graphBoosted.sort((a, b) => b.score - a.score);
    }
  }

  const projectMemoryPath = scope.memoryRootPath ? path.join(scope.memoryRootPath, scope.projectId) : null;
  const decayCfg: Partial<TemporalDecayConfig> = { enabled: decayEnabled, halfLifeDays, decayMinScore };
  const boosted = applyDecay(graphBoosted, decayCfg, projectMemoryPath);

  const filtered = boosted.filter((r) => r.score >= minScore);

  let filteredEmbs: (number[] | null)[] | undefined;
  if (queryVec && hasVecTable && filtered.length > 0) {
    const placeholders = filtered.map(() => '?').join(', ');
    const embRows = db
      .prepare(`SELECT id, embedding FROM chunks_vec WHERE id IN (${placeholders})`)
      .all(...filtered.map((r) => r.id)) as { id: string; embedding: Buffer }[];
    const embMap = new Map(embRows.map((r) => [r.id, Array.from(new Float32Array(r.embedding.buffer))]));
    filteredEmbs = filtered.map((r) => embMap.get(r.id) ?? null);
  }

  const reranked = mmrRerank(filtered, { enabled: true, lambda: mmrLambda }, filteredEmbs);
  const top = reranked.slice(0, maxResults);

  const topIds = top.map((r) => r.id);
  const entityMap = buildEntityMap(db, scope.projectId, topIds);

  return top.map((r) => {
    const threadId = r.source === 'sessions' ? r.path.replace('sessions/', '').replace('.jsonl', '') : undefined;
    return {
      id: r.id,
      source: r.source as 'memory' | 'sessions',
      path: r.path,
      title: r.source === 'sessions' ? `Session (${threadId})` : r.path,
      score: r.score,
      snippet: createSnippet(r.text, query),
      startLine: r.startLine,
      endLine: r.endLine,
      threadId,
      timestamp: r.updatedAt > 0 ? r.updatedAt : undefined,
      entities: entityMap.get(r.id),
    } satisfies MemorySearchHit;
  });
}

export type CodeSearchParams = {
  projectId?: string | null;
  threadId?: string | null;
  query: string;
  maxResults?: number;
  minScore?: number;
};

export async function searchCode(
  scope: SyncScope,
  params: CodeSearchParams,
  settings: AppSettings,
  provider: EmbeddingProvider | null,
  db: Database
): Promise<CodeSearchHit[]> {
  const query = params.query.trim();
  if (!query) return [];

  const ms = settings.memory ?? {};
  const projCfg = scope.projectPath
    ? loadProjectMemCfg(scope.projectPath, ms.decayHalfLifeDays ?? 45)
    : { ...CFG_DEFAULTS, halfLifeDays: ms.decayHalfLifeDays ?? 45 };

  const maxResults = params.maxResults ?? projCfg.maxResults ?? ms.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = params.minScore ?? projCfg.minScore ?? ms.minScore ?? 0.5;
  const vectorWeight = projCfg.codeVectorWeight ?? ms.codeVectorWeight ?? ms.vectorWeight ?? 0.55;
  const textWeight = projCfg.codeTextWeight ?? ms.codeTextWeight ?? ms.textWeight ?? 0.45;
  const mmrLambda = projCfg.mmrLambda ?? ms.mmrLambda ?? 0.7;

  const limitN = Math.max(maxResults * 6, 48);
  const hasVecTable = checkVecTable(db);

  const { merged, queryVec } = await buildHybridResults(
    db,
    query,
    " AND c.source = 'code'",
    [],
    scope.projectId,
    limitN,
    provider,
    hasVecTable,
    vectorWeight,
    textWeight
  );

  const codeHalfLifeDays = projCfg.codeDecayHalfLifeDays ?? ms.codeDecayHalfLifeDays ?? 180;
  const decayCfg: Partial<TemporalDecayConfig> = { enabled: true, halfLifeDays: codeHalfLifeDays, decayMinScore: 0.1 };
  const decayed = applyDecay(merged, decayCfg, null);
  const filtered = decayed.filter((r) => r.score >= minScore);

  let filteredEmbs: (number[] | null)[] | undefined;
  if (queryVec && hasVecTable && filtered.length > 0) {
    const placeholders = filtered.map(() => '?').join(', ');
    const embRows = db
      .prepare(`SELECT id, embedding FROM chunks_vec WHERE id IN (${placeholders})`)
      .all(...filtered.map((r) => r.id)) as { id: string; embedding: Buffer }[];
    const embMap = new Map(embRows.map((r) => [r.id, Array.from(new Float32Array(r.embedding.buffer))]));
    filteredEmbs = filtered.map((r) => embMap.get(r.id) ?? null);
  }

  const reranked = mmrRerank(filtered, { enabled: true, lambda: mmrLambda }, filteredEmbs);
  const top = reranked.slice(0, maxResults);

  const topIds = top.map((r) => r.id);
  const entityMap = buildEntityMap(db, scope.projectId, topIds);

  // Reachable from the renderer via memory:search with source='code' (routed
  // by MemorySyncCoordinator.search) and from agents via the MCP code_search tool.
  return top.map(
    (r) =>
      ({
        id: r.id,
        source: 'code' as const,
        path: r.path,
        title: r.path,
        score: r.score,
        snippet: createSnippet(r.text, query),
        startLine: r.startLine,
        endLine: r.endLine,
        timestamp: r.updatedAt > 0 ? r.updatedAt : undefined,
        entities: entityMap.get(r.id),
      }) satisfies CodeSearchHit
  );
}
