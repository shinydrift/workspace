import React from 'react';
import type { MemorySearchHit, MemorySourceFilter } from '../../../shared/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';
import { Button } from '../ui/button';
import type { useMemoryInspector } from '../../hooks/useMemoryInspector';
import { useGroupedChunks } from '../../hooks/useGroupedChunks';
import { ChunkFileGroup } from './ChunkFileGroup';
import { MemoryChunkListPagination } from './MemoryChunkListPagination';
import { MemorySearchResultsList } from './MemorySearchResultsList';

interface Props {
  source: MemorySourceFilter;
  showSearch: boolean;
  results: MemorySearchHit[];
  busy: string | null;
  error: string | null;
  inspector: ReturnType<typeof useMemoryInspector>;
  onOpenSearchHit: (hit: MemorySearchHit) => void;
  onOpenChunk: (chunkId: string) => void;
}

export function MemoryPanelBody({
  source,
  showSearch,
  results,
  busy,
  error,
  inspector,
  onOpenSearchHit,
  onOpenChunk,
}: Props) {
  const grouped = useGroupedChunks(inspector.chunks);

  const totalPages = Math.max(1, Math.ceil(inspector.total / inspector.pageSize));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!showSearch && (
        <div className="mx-auto flex w-full max-w-[1200px] items-center gap-2 px-3 py-2">
          <span
            className={`flex-1 text-xs text-muted-foreground transition-opacity ${inspector.busy ? 'opacity-50' : ''}`}
          >
            {inspector.total} chunks
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => void inspector.refresh()}
            disabled={inspector.busy}
          >
            {inspector.busy ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <ScrollFade />
        <ScrollArea className="h-full">
          <div className="max-w-[1200px] mx-auto w-full">
            {error && <div className="px-3 py-2 text-xs text-status-error">{error}</div>}
            {inspector.error && <div className="px-3 py-2 text-xs text-status-error">{inspector.error}</div>}
            {showSearch ? (
              <MemorySearchResultsList results={results} busy={busy} onSelect={onOpenSearchHit} />
            ) : inspector.busy ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
            ) : inspector.chunks.length === 0 ? (
              <div className="m-3 rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                {source === 'code'
                  ? 'No code chunks indexed yet — indexing runs in the background.'
                  : 'No indexed chunks.'}
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {[...grouped.entries()].map(([filePath, fileChunks]) => (
                  <ChunkFileGroup
                    key={filePath}
                    filePath={filePath}
                    fileChunks={fileChunks}
                    selectedChunkId={inspector.selectedChunkId}
                    onSelectChunk={onOpenChunk}
                    onDeleteFile={source === 'code' ? undefined : (path) => void inspector.deleteFile(path)}
                  />
                ))}
                <MemoryChunkListPagination
                  page={inspector.page}
                  totalPages={totalPages}
                  total={inspector.total}
                  busy={inspector.busy}
                  onSetPage={(p) => void inspector.setPage(p)}
                />
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
