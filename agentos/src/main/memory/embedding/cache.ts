// eslint-disable-next-line import/no-named-as-default
import type Database from 'better-sqlite3';
import { createEmbeddingProvider, type EmbeddingProvider } from './provider';
import { runtimeLogger as eventLogger } from '../runtime';
import type { ApiKeys, MemoryConfig } from '../../../shared/types';

const EMBEDDING_BATCH_SIZE = 16;
const EMBEDDING_CACHE_MAX_ENTRIES = 10_000;

// ─── Provider cache ────────────────────────────────────────────────────────────

let cachedProvider: EmbeddingProvider | null | undefined;
let providerCacheKey = '';

export type AppSettingsSubset = {
  memory?: Pick<MemoryConfig, 'embeddingProvider' | 'embeddingModel' | 'localModelPath'>;
  apiKeys?: ApiKeys;
};

export async function getProvider(settings: AppSettingsSubset): Promise<EmbeddingProvider | null> {
  const currentKey = JSON.stringify({
    p: settings.memory?.embeddingProvider,
    m: settings.memory?.embeddingModel,
    l: settings.memory?.localModelPath,
    k: settings.apiKeys,
  });
  if (cachedProvider !== undefined && currentKey === providerCacheKey) return cachedProvider;
  providerCacheKey = currentKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cachedProvider = await createEmbeddingProvider(settings as any);
  return cachedProvider;
}

// ─── Cache I/O ────────────────────────────────────────────────────────────────

function loadEmbeddingCache(
  db: Database.Database,
  provider: EmbeddingProvider,
  hashes: string[]
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (hashes.length === 0) return result;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
    const batch = hashes.slice(i, i + CHUNK_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT hash, embedding FROM embedding_cache
       WHERE provider = ? AND model = ? AND provider_key = ? AND hash IN (${placeholders})`
      )
      .all(provider.id, provider.model, provider.providerKey, ...batch) as Array<{ hash: string; embedding: string }>;
    for (const row of rows) {
      try {
        result.set(row.hash, JSON.parse(row.embedding) as number[]);
      } catch {
        /* skip */
      }
    }
  }
  return result;
}

function upsertEmbeddingCache(
  db: Database.Database,
  provider: EmbeddingProvider,
  entries: Array<{ hash: string; embedding: number[] }>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO embedding_cache
     (provider, model, provider_key, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  db.transaction(() => {
    for (const { hash, embedding } of entries) {
      stmt.run(
        provider.id,
        provider.model,
        provider.providerKey,
        hash,
        JSON.stringify(embedding),
        embedding.length,
        now
      );
    }
  })();
}

// P2-B: run orphan eviction every N calls — the NOT IN subquery is a full scan, skip it on each batch.
let _pruneCallCount = 0;
const ORPHAN_EVICTION_FREQUENCY = 50;

function pruneEmbeddingCache(db: Database.Database): void {
  if (++_pruneCallCount % ORPHAN_EVICTION_FREQUENCY === 0) {
    db.prepare('DELETE FROM embedding_cache WHERE hash NOT IN (SELECT DISTINCT hash FROM chunks)').run();
  }
  const count = (db.prepare('SELECT COUNT(*) AS n FROM embedding_cache').get() as { n: number }).n;
  if (count <= EMBEDDING_CACHE_MAX_ENTRIES) return;
  db.prepare(
    `DELETE FROM embedding_cache WHERE rowid NOT IN (
       SELECT rowid FROM embedding_cache ORDER BY updated_at DESC LIMIT ?)`
  ).run(EMBEDDING_CACHE_MAX_ENTRIES);
}

// ─── Batch embed with caching ─────────────────────────────────────────────────

export async function embedChunks(
  db: Database.Database,
  provider: EmbeddingProvider,
  chunks: Array<{ id: string; text: string; hash: string }>
): Promise<Map<string, number[]>> {
  const embedMap = new Map<string, number[]>();
  const hashes = [...new Set(chunks.map((c) => c.hash))];
  const cached = loadEmbeddingCache(db, provider, hashes);
  for (const [h, vec] of cached) embedMap.set(h, vec);

  const needEmbed = chunks.filter((c) => !embedMap.has(c.hash));
  if (needEmbed.length === 0) return embedMap;

  for (let i = 0; i < needEmbed.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = needEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const vecs = await provider.embedBatch(batch.map((c) => c.text));
      const toCache: Array<{ hash: string; embedding: number[] }> = [];
      batch.forEach((chunk, idx) => {
        const vec = vecs[idx];
        if (vec && vec.length > 0) {
          embedMap.set(chunk.hash, vec);
          toCache.push({ hash: chunk.hash, embedding: vec });
        }
      });
      if (toCache.length > 0) {
        upsertEmbeddingCache(db, provider, toCache);
        eventLogger.debug('memory', 'Embedded chunks', {
          provider: provider.id,
          model: provider.model,
          count: toCache.length,
        });
      }
    } catch (err) {
      eventLogger.warn('memory', 'Embedding batch failed; skipping', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  pruneEmbeddingCache(db);
  return embedMap;
}
