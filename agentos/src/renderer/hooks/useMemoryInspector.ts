import { useState, useCallback } from 'react';
import type { ChunkRow, MemorySourceFilter } from '../../shared/types';
import { useAsyncOp } from './useAsyncOp';

export interface InspectorState {
  chunks: ChunkRow[];
  total: number;
  page: number;
  source: MemorySourceFilter;
  selectedChunkId: string | null;
  busy: boolean;
  error: string | null;
  hasLoaded: boolean;
}

const PAGE_SIZE = 100;

export function useMemoryInspector(threadId: string) {
  const { busy, error, run } = useAsyncOp();
  const [state, setState] = useState<Omit<InspectorState, 'busy' | 'error'>>({
    chunks: [],
    total: 0,
    page: 0,
    source: 'all',
    selectedChunkId: null,
    hasLoaded: false,
  });

  const loadPage = useCallback(
    async (page: number, source: MemorySourceFilter) => {
      await run(async () => {
        const result = await window.electronAPI.memory.list({ threadId, source, page, pageSize: PAGE_SIZE });
        setState((s) => ({ ...s, chunks: result.chunks, total: result.total, page, source, hasLoaded: true }));
      });
    },
    [threadId, run]
  );

  const refresh = useCallback(() => loadPage(state.page, state.source), [loadPage, state.page, state.source]);
  const setSource = useCallback((source: MemorySourceFilter) => loadPage(0, source), [loadPage]);
  const setPage = useCallback((page: number) => loadPage(page, state.source), [loadPage, state.source]);
  const selectChunk = useCallback((id: string | null) => setState((s) => ({ ...s, selectedChunkId: id })), []);

  const deleteChunk = useCallback(
    async (chunkId: string) => {
      await run(async () => {
        await window.electronAPI.memory.deleteChunk({ threadId, chunkId });
        setState((s) => ({
          ...s,
          chunks: s.chunks.filter((c) => c.id !== chunkId),
          total: s.total - 1,
          selectedChunkId: s.selectedChunkId === chunkId ? null : s.selectedChunkId,
        }));
      });
    },
    [threadId, run]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      setState((s) => ({
        ...s,
        // Clear selection if the selected chunk belongs to this file
        selectedChunkId: s.chunks.find((c) => c.id === s.selectedChunkId)?.path === path ? null : s.selectedChunkId,
      }));
      await run(async () => {
        await window.electronAPI.memory.deleteFile({ threadId, path });
        // Reload page 0 from server so total and pagination are accurate (file may span multiple pages)
        await loadPage(0, state.source);
      });
    },
    [threadId, run, loadPage, state.source]
  );

  const updateChunk = useCallback(
    async (chunkId: string, text: string) => {
      await run(async () => {
        await window.electronAPI.memory.updateChunk({ threadId, chunkId, text });
        setState((s) => ({
          ...s,
          chunks: s.chunks.map((c) => (c.id === chunkId ? { ...c, text, userEdited: true } : c)),
        }));
      });
    },
    [threadId, run]
  );

  const pinChunk = useCallback(
    async (chunkId: string, pinned: boolean) => {
      await run(async () => {
        await window.electronAPI.memory.pinChunk({ threadId, chunkId, pinned });
        setState((s) => ({
          ...s,
          chunks: s.chunks.map((c) => (c.id === chunkId ? { ...c, pinned } : c)),
        }));
      });
    },
    [threadId, run]
  );

  const selectedChunk = state.chunks.find((c) => c.id === state.selectedChunkId) ?? null;

  return {
    ...state,
    busy,
    error,
    pageSize: PAGE_SIZE,
    selectedChunk,
    refresh,
    setSource,
    setPage,
    selectChunk,
    deleteChunk,
    deleteFile,
    updateChunk,
    pinChunk,
  };
}
