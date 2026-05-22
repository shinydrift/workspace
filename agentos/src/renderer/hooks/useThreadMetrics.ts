import { useMemo } from 'react';
import type { SessionMetrics, TurnMetric } from '../../shared/types';
import { formatDuration } from '../lib/analyticsFormatters';

export function useThreadMetrics(metrics: SessionMetrics | null, turns: TurnMetric[] | null) {
  const turnsWithChunk = useMemo(() => turns?.filter((t) => t.firstChunkAt != null) ?? [], [turns]);

  const duration = useMemo(() => {
    if (!metrics || !turns || turns.length === 0) return null;
    const completedMs = turns.reduce((acc, t) => acc + (t.timestamp - t.startedAt), 0);
    return formatDuration(completedMs);
  }, [metrics, turns]);

  const avgTtft = useMemo(() => {
    if (turnsWithChunk.length === 0) return null;
    const totalMs = turnsWithChunk.reduce((acc, t) => acc + (t.firstChunkAt! - t.startedAt), 0);
    return formatDuration(Math.round(totalMs / turnsWithChunk.length));
  }, [turnsWithChunk]);

  const tokensPerSec = useMemo(() => {
    if (!metrics || turnsWithChunk.length === 0) return null;
    const totalStreamMs = turnsWithChunk.reduce((acc, t) => acc + (t.timestamp - t.firstChunkAt!), 0);
    if (totalStreamMs <= 0) return null;
    return `${Math.round((metrics.outputTokens / totalStreamMs) * 1000)} tok/s`;
  }, [metrics, turnsWithChunk]);

  return { duration, avgTtft, tokensPerSec };
}
