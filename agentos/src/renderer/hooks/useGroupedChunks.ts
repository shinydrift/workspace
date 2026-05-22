import { useMemo } from 'react';
import type { ChunkRow } from '../../shared/types';

export function useGroupedChunks(chunks: ChunkRow[]): Map<string, ChunkRow[]> {
  return useMemo(() => {
    const map = new Map<string, ChunkRow[]>();
    for (const chunk of chunks) {
      const existing = map.get(chunk.path);
      if (existing) existing.push(chunk);
      else map.set(chunk.path, [chunk]);
    }
    return map;
  }, [chunks]);
}
