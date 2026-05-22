import type { Database } from 'better-sqlite3';
import { applyDecay, type TemporalDecayConfig } from './search/temporalDecay';
import { buildFtsQuery, bm25RankToScore } from './search/hybrid';
import { hashText } from './utils';
import { checkObsVecTable, ensureObsVecTable } from './db';
import type { EmbeddingProvider } from './embedding/provider';

export interface ObservationSearchHit {
  entityId: string;
  entityName: string;
  entityType: string;
  observationId: string;
  text: string;
  score: number;
  createdAt: number;
  sourceChunkId?: string | null;
}

export function observationId(entityId: string, text: string): string {
  return hashText(`${entityId}:${text}`);
}

/** Insert an observation for an entity (idempotent — INSERT OR IGNORE handles duplicates). */
export function assertObservation(
  db: Database,
  entityId: string,
  text: string,
  projectId: string,
  sourceChunkId?: string | null
): string {
  const id = observationId(entityId, text);
  const now = Date.now();
  db.transaction(() => {
    const { changes } = db
      .prepare(
        'INSERT OR IGNORE INTO observations (id, entity_id, project_id, text, source_chunk_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, entityId, projectId, text, sourceChunkId ?? null, now);
    if (changes > 0) {
      db.prepare('INSERT INTO observations_fts (id, entity_id, project_id, text) VALUES (?, ?, ?, ?)').run(
        id,
        entityId,
        projectId,
        text
      );
    }
  })();
  return id;
}

/** Delete an observation by id (removes from both tables). */
export function deleteObservation(db: Database, id: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM observations_fts WHERE id = ?').run(id);
    db.prepare('DELETE FROM observations WHERE id = ?').run(id);
  })();
}

/**
 * Embed any observations for the project that are not yet in observations_vec.
 * Called lazily at search time so the write path stays synchronous.
 */
async function indexObservationEmbeddings(db: Database, projectId: string, provider: EmbeddingProvider): Promise<void> {
  const unindexed = db
    .prepare(
      `SELECT o.id, o.text FROM observations o
       WHERE o.project_id = ?
       AND NOT EXISTS (SELECT 1 FROM observations_vec v WHERE v.id = o.id)`
    )
    .all(projectId) as { id: string; text: string }[];
  if (unindexed.length === 0) return;

  const insertStmt = db.prepare('INSERT OR IGNORE INTO observations_vec (id, embedding) VALUES (?, vec_f32(?))');
  const BATCH = 16;
  for (let i = 0; i < unindexed.length; i += BATCH) {
    const batch = unindexed.slice(i, i + BATCH);
    try {
      const embeddings = await provider.embedBatch(batch.map((o) => o.text));
      db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          insertStmt.run(batch[j]!.id, Buffer.from(new Float32Array(embeddings[j]!).buffer));
        }
      })();
    } catch {
      /* embedding failure is non-fatal — remaining observations fall back to BM25 */
      break;
    }
  }
}

/** Hybrid BM25 + vector search over observations, joined with entity metadata.
 *  queryVec + provider are optional — omitting them falls back to BM25-only. */
export async function searchObservations(
  db: Database,
  projectId: string,
  query: string,
  topK = 10,
  decayCfg?: Partial<TemporalDecayConfig>,
  queryVec?: number[] | null,
  provider?: EmbeddingProvider | null
): Promise<ObservationSearchHit[]> {
  // score map accumulates hits from BM25 and/or vector search, keyed by observation id
  const scoreMap = new Map<string, ObservationSearchHit>();

  // ── BM25 branch ────────────────────────────────────────────────────────────
  const ftsQ = buildFtsQuery(query);
  if (ftsQ) {
    const rows = db
      .prepare(
        `SELECT o.id AS obs_id, o.entity_id, o.text AS obs_text, o.created_at, o.source_chunk_id,
                e.name AS entity_name, e.type AS entity_type,
                -bm25(observations_fts) AS bm25_rank
         FROM observations_fts
         JOIN observations o ON o.id = observations_fts.id
         JOIN entities e ON e.id = o.entity_id
         WHERE observations_fts MATCH ? AND o.project_id = ?
         ORDER BY bm25_rank ASC LIMIT ?`
      )
      .all(ftsQ, projectId, topK * 2) as Array<{
      obs_id: string;
      entity_id: string;
      obs_text: string;
      created_at: number;
      source_chunk_id: string | null;
      entity_name: string;
      entity_type: string;
      bm25_rank: number;
    }>;
    for (const r of rows) {
      scoreMap.set(r.obs_id, {
        entityId: r.entity_id,
        entityName: r.entity_name,
        entityType: r.entity_type,
        observationId: r.obs_id,
        text: r.obs_text,
        score: bm25RankToScore(r.bm25_rank),
        createdAt: r.created_at,
        sourceChunkId: r.source_chunk_id,
      });
    }
  }

  // ── Vector branch ──────────────────────────────────────────────────────────
  if (queryVec && queryVec.length > 0 && provider) {
    ensureObsVecTable(db, provider.dims);
    await indexObservationEmbeddings(db, projectId, provider);

    if (checkObsVecTable(db)) {
      const vecRows = db
        .prepare(
          `SELECT ov.id AS obs_id, o.entity_id, o.text AS obs_text, o.created_at, o.source_chunk_id,
                  e.name AS entity_name, e.type AS entity_type,
                  vec_distance_cosine(ov.embedding, vec_f32(?)) AS dist
           FROM observations_vec ov
           JOIN observations o ON o.id = ov.id
           JOIN entities e ON e.id = o.entity_id
           WHERE o.project_id = ?
           ORDER BY dist ASC LIMIT ?`
        )
        .all(Buffer.from(new Float32Array(queryVec).buffer), projectId, topK * 2) as Array<{
        obs_id: string;
        entity_id: string;
        obs_text: string;
        created_at: number;
        source_chunk_id: string | null;
        entity_name: string;
        entity_type: string;
        dist: number;
      }>;
      for (const r of vecRows) {
        const vecScore = Math.max(0, 1 - r.dist);
        const existing = scoreMap.get(r.obs_id);
        if (existing) {
          // Blend: 60% vector, 40% BM25 when both find the same observation
          existing.score = 0.6 * vecScore + 0.4 * existing.score;
        } else {
          scoreMap.set(r.obs_id, {
            entityId: r.entity_id,
            entityName: r.entity_name,
            entityType: r.entity_type,
            observationId: r.obs_id,
            text: r.obs_text,
            score: vecScore,
            createdAt: r.created_at,
            sourceChunkId: r.source_chunk_id,
          });
        }
      }
    }
  }

  if (scoreMap.size === 0) return [];

  let hits = [...scoreMap.values()].sort((a, b) => b.score - a.score);

  if (decayCfg?.enabled) {
    type DecayInput = { id: string; score: number; updatedAt: number; path: string; source: string; pinned?: boolean };
    const decayInput: DecayInput[] = hits.map((h) => ({
      id: h.observationId,
      score: h.score,
      updatedAt: h.createdAt,
      path: '',
      source: '',
    }));
    const decayed = applyDecay(decayInput, decayCfg, null);
    const decayMap = new Map(decayed.map((d) => [d.id, d.score]));
    hits = hits
      .map((h) => ({ ...h, score: decayMap.get(h.observationId) ?? h.score }))
      .filter((h) => h.score >= (decayCfg.decayMinScore ?? 0))
      .sort((a, b) => b.score - a.score);
  }

  return hits.slice(0, topK);
}
