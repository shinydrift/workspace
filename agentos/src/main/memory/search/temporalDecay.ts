import fs from 'fs';
import path from 'path';

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number;
  /** Minimum score floor applied after decay (0 = no floor). */
  decayMinScore?: number;
}

export const DEFAULT_DECAY_CONFIG: TemporalDecayConfig = {
  enabled: true,
  halfLifeDays: 45,
  decayMinScore: 0,
};

/** Matches dated memory files like `memory/2026-05-23.md`. */
const DATED_PATH_RE = /(?:^|\/)memory\/(\d{4})-(\d{2})-(\d{2})\.md$/;

/** Evergreen paths that never decay. */
function isEvergreen(relPath: string): boolean {
  const base = path.basename(relPath).toLowerCase();
  return base === 'memory.md' || base === 'boot.md';
}

/** Code paths that should not decay (vendored, generated, or VCS metadata). */
function isEvergreenCode(relPath: string): boolean {
  return /(?:^|\/)(?:node_modules|\.git|vendor|dist|build|\.next|\.nuxt|__generated__|generated)(?:\/|$)/.test(relPath);
}

function calculateMultiplier(ageInDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0 || !Number.isFinite(halfLifeDays)) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * Math.max(0, ageInDays));
}

/**
 * Resolve the timestamp (ms) to use for decay for a given chunk.
 * - Session chunks: use `updatedAt` (message timestamp)
 * - Dated memory files (`memory/YYYY-MM-DD.md`): parse date from filename
 * - Evergreen files (MEMORY.md, BOOT.md): null → no decay
 * - Other memory files: use file mtime
 */
function resolveTimestampMs(
  relPath: string,
  source: string,
  updatedAt: number,
  workspaceDir: string | null
): number | null {
  if (source === 'sessions') return updatedAt > 0 ? updatedAt : null;
  if (source === 'code') return isEvergreenCode(relPath) ? null : updatedAt > 0 ? updatedAt : null;
  if (isEvergreen(relPath)) return null;

  const datedMatch = DATED_PATH_RE.exec(relPath);
  if (datedMatch) {
    const [, year, month, day] = datedMatch;
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  // Fall back to mtime for other memory files
  if (workspaceDir) {
    try {
      const absPath = path.join(workspaceDir, relPath);
      return fs.statSync(absPath).mtimeMs;
    } catch {
      /* file may not exist */
    }
  }
  return null;
}

export interface DecayableResult {
  path: string;
  source: string;
  score: number;
  updatedAt: number;
  /** If truthy, skip decay for this chunk. */
  pinned?: boolean;
}

export function applyDecay<T extends DecayableResult>(
  results: T[],
  config: Partial<TemporalDecayConfig> | undefined,
  workspaceDir: string | null,
  nowMs = Date.now()
): T[] {
  const cfg = { ...DEFAULT_DECAY_CONFIG, ...config };
  if (!cfg.enabled) return results;
  const minScore = cfg.decayMinScore ?? 0;
  return results.map((result) => {
    // Pinned chunks are exempt from decay
    if (result.pinned) return result;
    const timestampMs = resolveTimestampMs(result.path, result.source, result.updatedAt, workspaceDir);
    if (timestampMs === null) return result;
    const ageInDays = (nowMs - timestampMs) / 86_400_000;
    const multiplier = calculateMultiplier(ageInDays, cfg.halfLifeDays);
    const decayed = result.score * multiplier;
    const floored = minScore > 0 ? Math.max(minScore, decayed) : decayed;
    return { ...result, score: Number(floored.toFixed(4)) };
  });
}
