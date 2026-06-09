import { runtimeProjects } from './runtime';
import type { MemoryProjectStats, MemoryThreadChunk } from '../../shared/types';
import { getProjectDb } from './projectDb';

export class MemoryStatsService {
  private projectStatsCache = new Map<string, { data: MemoryProjectStats; expiry: number }>();
  private expansionCountsCache: { data: { thisWeek: number; lastWeek: number }; expiry: number } | null = null;

  invalidate(projectId: string): void {
    this.projectStatsCache.delete(projectId);
  }

  getThreadChunks(projectId: string, threadId: string, limit: number): MemoryThreadChunk[] {
    const db = getProjectDb(projectId);
    const sessionPath = `sessions/${threadId}.jsonl`;
    const rows = db
      .prepare('SELECT id, summary, updated_at FROM chunks WHERE path = ? ORDER BY updated_at DESC LIMIT ?')
      .all(sessionPath, limit) as Array<{ id: string; summary: string; updated_at: number }>;
    return rows.map((r) => ({ chunkId: r.id, summary: r.summary, updatedAt: r.updated_at }));
  }

  getGlobalExpansionCounts(): { thisWeek: number; lastWeek: number } {
    const nowMs = Date.now();
    if (this.expansionCountsCache && nowMs < this.expansionCountsCache.expiry) {
      return this.expansionCountsCache.data;
    }
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgoMs = nowMs - 14 * 24 * 60 * 60 * 1000;
    let thisWeek = 0;
    let lastWeek = 0;
    const projectIds = runtimeProjects().map((p) => p.id);
    const stmt =
      'SELECT COALESCE(SUM(CASE WHEN expanded_at >= ? THEN 1 ELSE 0 END), 0) AS this_week, COALESCE(SUM(CASE WHEN expanded_at >= ? AND expanded_at < ? THEN 1 ELSE 0 END), 0) AS last_week FROM chunk_expansions';
    for (const projectId of projectIds) {
      try {
        const db = getProjectDb(projectId);
        const row = db.prepare(stmt).get(sevenDaysAgoMs, fourteenDaysAgoMs, sevenDaysAgoMs) as {
          this_week: number;
          last_week: number;
        };
        thisWeek += row.this_week;
        lastWeek += row.last_week;
      } catch {
        /* DB may not exist for this project */
      }
    }
    const data = { thisWeek, lastWeek };
    this.expansionCountsCache = { data, expiry: nowMs + 60_000 };
    return data;
  }

  getProjectStats(projectId: string): MemoryProjectStats {
    const now = Date.now();
    const cached = this.projectStatsCache.get(projectId);
    if (cached && now < cached.expiry) return cached.data;

    const db = getProjectDb(projectId);
    const data = db.transaction(() => {
      const sourceCounts = db.prepare('SELECT source, COUNT(*) as n FROM chunks GROUP BY source').all() as Array<{
        source: string;
        n: number;
      }>;
      let memoryChunks = 0;
      let sessionChunks = 0;
      for (const row of sourceCounts) {
        if (row.source === 'memory') memoryChunks = row.n;
        else if (row.source === 'sessions') sessionChunks = row.n;
      }
      const totalChunks = memoryChunks + sessionChunks;

      const { totalExpansions, expandedChunkCount } = db
        .prepare(
          'SELECT COUNT(*) AS totalExpansions, COUNT(DISTINCT chunk_id) AS expandedChunkCount FROM chunk_expansions'
        )
        .get() as { totalExpansions: number; expandedChunkCount: number };
      const neverExpandedCount = totalChunks - expandedChunkCount;

      const topExpanded = (
        db
          .prepare(
            `SELECT c.id, c.path,
              COALESCE(NULLIF(c.summary, ''), SUBSTR(c.text, 1, 120)) as label,
              COUNT(*) as n
            FROM chunk_expansions ce JOIN chunks c ON ce.chunk_id = c.id
            GROUP BY ce.chunk_id ORDER BY n DESC LIMIT 5`
          )
          .all() as Array<{ id: string; path: string; label: string; n: number }>
      ).map((r) => ({ chunkId: r.id, label: r.label, path: r.path, expansionCount: r.n }));

      const recentSessionChunks = (
        db
          .prepare(
            `SELECT id, COALESCE(NULLIF(summary, ''), SUBSTR(text, 1, 120)) as label, updated_at
            FROM chunks WHERE source = 'sessions'
            ORDER BY updated_at DESC LIMIT 5`
          )
          .all() as Array<{ id: string; label: string; updated_at: number }>
      ).map((r) => ({ chunkId: r.id, label: r.label, updatedAt: r.updated_at }));

      return {
        totalChunks,
        memoryChunks,
        sessionChunks,
        totalExpansions,
        neverExpandedCount,
        topExpanded,
        recentSessionChunks,
        memoryGetCallCount: 0,
      };
    })();
    this.projectStatsCache.set(projectId, { data, expiry: now + 60_000 });
    return data;
  }
}
