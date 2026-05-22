import { extractKeywords } from './queryExpansion';

const PIN_BOOST = 0.2;
const FTS_AND_THRESHOLD = 4;
const K = 20; // candidate pool is limitN=max(maxResults*8,64) in searchEngine.ts; revisit if pool size grows significantly
const EXPANSION_BOOST_PER_COUNT = 0.05;
const EXPANSION_BOOST_MAX = 0.2;

export interface HybridResult {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  model: string;
  updatedAt: number;
  vectorScore: number;
  textScore: number;
  score: number;
  pinned: boolean;
}

export interface VectorRow {
  id: string;
  path: string;
  source: string;
  start_line: number;
  end_line: number;
  text: string;
  model: string;
  updated_at: number;
  dist: number;
  pinned: number;
}

export interface KeywordRow {
  id: string;
  path: string;
  source: string;
  start_line: number;
  end_line: number;
  text: string;
  model: string;
  updated_at: number;
  bm25_rank: number;
  pinned: number;
}

/**
 * Build an FTS5 query from raw input.
 *
 * Strategy:
 * - Extract meaningful keywords by filtering stop words.
 * - ≥4 keywords → AND-join for BM25 precision on large corpora.
 * - <4 keywords → OR-join for recall, letting vector search supply precision.
 * - forceOr=true overrides the AND path (used by the OR-fallback retry).
 * - Falls back to AND-of-all-tokens when no keywords remain after stop-word filtering.
 */
export function buildFtsQuery(raw: string, forceOr = false): string | null {
  const allTokens =
    raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.toLowerCase())
      .filter(Boolean) ?? [];
  if (allTokens.length === 0) return null;

  const keywords = extractKeywords(raw);
  if (keywords.length === 0) {
    // No meaningful keywords — fall back to AND of all tokens
    return allTokens.map((t) => `"${t.replaceAll('"', '')}"`).join(' AND ');
  }

  const join = !forceOr && keywords.length >= FTS_AND_THRESHOLD ? ' AND ' : ' OR ';
  return keywords.map((t) => `"${t.replaceAll('"', '')}"`).join(join);
}

/** Convert a BM25 rank (lower = better, starts at 0) to a [0,1] score. */
export function bm25RankToScore(rank: number): number {
  const r = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + r);
}

export function mergeHybridResults(params: {
  vector: VectorRow[];
  keyword: KeywordRow[];
  vectorWeight?: number;
  textWeight?: number;
  expansionCounts?: Map<string, number>;
}): HybridResult[] {
  const { vector, keyword, vectorWeight = 0.7, textWeight = 0.3, expansionCounts } = params;

  const maxRrf = (vectorWeight + textWeight) / K;
  if (maxRrf === 0) return [];
  const vectorMap = new Map(vector.map((r, i) => [r.id, { rank: i + 1, row: r }]));
  const keywordMap = new Map(keyword.map((r, i) => [r.id, { rank: i + 1, row: r }]));

  const allIds = new Set([...vectorMap.keys(), ...keywordMap.keys()]);
  const map = new Map<string, HybridResult>();

  for (const id of allIds) {
    const vEntry = vectorMap.get(id);
    const kEntry = keywordMap.get(id);
    const row = (vEntry?.row ?? kEntry?.row)!;

    const rrf = (vEntry ? vectorWeight / (K + vEntry.rank) : 0) + (kEntry ? textWeight / (K + kEntry.rank) : 0);
    const score = Math.min(1, rrf / maxRrf);

    map.set(id, {
      id,
      path: row.path,
      source: row.source,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      model: row.model,
      updatedAt: row.updated_at,
      vectorScore: vEntry ? Math.max(0, Math.min(1, 1 - vEntry.row.dist)) : 0,
      textScore: kEntry ? bm25RankToScore(kEntry.row.bm25_rank) : 0,
      score,
      pinned: (vEntry?.row.pinned ?? kEntry?.row.pinned ?? 0) === 1,
    });
  }

  const results = [...map.values()];
  for (const r of results) {
    if (r.pinned) r.score = r.score + PIN_BOOST * (1 - r.score);
    if (expansionCounts) {
      const count = expansionCounts.get(r.id) ?? 0;
      if (count > 0)
        r.score = r.score + Math.min(EXPANSION_BOOST_MAX, count * EXPANSION_BOOST_PER_COUNT) * (1 - r.score);
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
