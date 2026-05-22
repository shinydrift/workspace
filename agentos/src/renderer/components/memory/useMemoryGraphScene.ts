import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EdgeRecord, EntityNode, EntityType } from '../../../main/memory/graph';

export const ALL_ENTITY_TYPES: EntityType[] = ['file', 'symbol', 'issue', 'decision', 'person', 'concept'];

const PAGE_SIZE = 200;

function applyNodeFilters(
  nodes: EntityNode[],
  edges: EdgeRecord[],
  types: Set<EntityType>,
  hideOrphans: boolean
): EntityNode[] {
  let filtered = nodes.filter((n) => types.has(n.type as EntityType));
  if (hideOrphans) {
    const connectedIds = new Set<string>();
    for (const e of edges) {
      connectedIds.add(e.fromId);
      connectedIds.add(e.toId);
    }
    filtered = filtered.filter((n) => connectedIds.has(n.id));
  }
  return filtered;
}

export function useMemoryGraphScene(threadId: string) {
  const [selectedEntity, setSelectedEntity] = useState<EntityNode | null>(null);
  const [selectedChunks, setSelectedChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const [allNodes, setAllNodes] = useState<EntityNode[]>([]);
  const [allEdges, setAllEdges] = useState<EdgeRecord[]>([]);

  // Incremented each time loadAll starts; lets in-flight pages detect they're stale.
  const loadGenRef = useRef(0);

  const [activeTypes, setActiveTypes] = useState<Set<EntityType>>(new Set(ALL_ENTITY_TYPES));
  const [hideOrphans, setHideOrphans] = useState(false);

  const resetSelection = useCallback(() => {
    setSelectedEntity(null);
    setSelectedChunks([]);
  }, []);

  const loadAll = useCallback(async () => {
    const gen = ++loadGenRef.current;

    setLoading(true);
    setError(null);
    resetSelection();
    setAllNodes([]);
    setAllEdges([]);

    try {
      const accumulatedNodes: EntityNode[] = [];
      const accumulatedEdges: EdgeRecord[] = [];
      let offset = 0;
      let hasMore = true;
      let firstPage = true;

      while (hasMore) {
        const result = await window.electronAPI.memory.graphAllPage({ threadId, offset, limit: PAGE_SIZE });
        if (gen !== loadGenRef.current) return;

        accumulatedNodes.push(...result.nodes);
        accumulatedEdges.push(...result.edges);
        hasMore = result.hasMore;
        offset += result.nodes.length;

        if (firstPage) {
          setTotalCount(result.total);
          firstPage = false;
        }

        // Stream updates so the graph grows as pages arrive.
        setAllNodes(accumulatedNodes.slice());
        setAllEdges(accumulatedEdges.slice());
      }

      if (firstPage) setTotalCount(0); // empty graph case
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      setAllNodes([]);
      setAllEdges([]);
      setTotalCount(0);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [resetSelection, threadId]);

  const handleReindex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await window.electronAPI.memory.reindexGraph(threadId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadAll, threadId]);

  const handleSelectEntity = useCallback(
    async (entity: EntityNode) => {
      setSelectedEntity(entity);
      try {
        const result = await window.electronAPI.memory.getEntityChunks({ threadId, entityId: entity.id });
        setSelectedChunks(result.chunkIds);
      } catch {
        setSelectedChunks(entity.chunkIds);
      }
    },
    [threadId]
  );

  const toggleType = useCallback((type: EntityType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleOrphans = useCallback(() => setHideOrphans((prev) => !prev), []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredNodes = useMemo(
    () => applyNodeFilters(allNodes, allEdges, activeTypes, hideOrphans),
    [allNodes, allEdges, activeTypes, hideOrphans]
  );

  const filteredEdges = useMemo(() => {
    const ids = new Set(filteredNodes.map((n) => n.id));
    return allEdges.filter((e) => ids.has(e.fromId) && ids.has(e.toId));
  }, [filteredNodes, allEdges]);

  return {
    activeTypes,
    edges: filteredEdges,
    error,
    handleReindex,
    handleSelectEntity,
    hasData: allNodes.length > 0,
    hideOrphans,
    loading,
    nodes: filteredNodes,
    selectedChunks,
    selectedEntity,
    toggleOrphans,
    toggleType,
    totalCount,
    visibleCount: filteredNodes.length,
  };
}
