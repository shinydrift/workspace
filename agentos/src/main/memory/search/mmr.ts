export interface MMRConfig {
  enabled: boolean;
  // 0 = maximum diversity, 1 = pure relevance. Default: 0.7
  lambda: number;
}

export const DEFAULT_MMR_CONFIG: MMRConfig = { enabled: true, lambda: 0.7 };

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Assumes a.length === b.length — guaranteed because all chunks are indexed with the same provider model.
function cosineSim(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function mmrRerank<T extends { score: number; text: string }>(
  items: T[],
  config: Partial<MMRConfig> = {},
  embeddings?: (number[] | null)[] // parallel to items; null = use Jaccard fallback
): T[] {
  const cfg = { ...DEFAULT_MMR_CONFIG, ...config };
  if (!cfg.enabled || items.length <= 1 || cfg.lambda >= 1) {
    return [...items].sort((a, b) => b.score - a.score);
  }

  // Pair items with embeddings before sorting so they stay aligned
  const paired = items.map((item, i) => ({ item, emb: embeddings?.[i] ?? null }));
  const sorted = [...paired].sort((a, b) => b.item.score - a.item.score);
  const sortedItems = sorted.map((p) => p.item);
  const sortedEmbs = sorted.map((p) => p.emb);

  const minScore = sortedItems.at(-1)!.score;
  const maxScore = sortedItems[0]!.score;
  const range = maxScore - minScore || 1;

  // Pre-tokenize all items (used as Jaccard fallback)
  const tokenSets = sortedItems.map((item) => tokenize(item.text));
  const normScores = sortedItems.map((item) => (item.score - minScore) / range);

  const selected: T[] = [];
  const selectedIndices: number[] = [];
  const remaining = sortedItems.map((_, i) => i);

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (const idx of remaining) {
      let maxSim = 0;
      for (const selIdx of selectedIndices) {
        const hasEmb = sortedEmbs[idx] != null && sortedEmbs[selIdx] != null;
        const sim = hasEmb
          ? cosineSim(sortedEmbs[idx]!, sortedEmbs[selIdx]!)
          : jaccardSimilarity(tokenSets[idx]!, tokenSets[selIdx]!);
        if (sim > maxSim) maxSim = sim;
      }
      const mmrScore = cfg.lambda * normScores[idx]! - (1 - cfg.lambda) * maxSim;
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;
    selected.push(sortedItems[bestIdx]!);
    selectedIndices.push(bestIdx);
    remaining.splice(remaining.indexOf(bestIdx), 1);
  }

  return selected;
}
