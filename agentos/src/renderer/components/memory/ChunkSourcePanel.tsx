import React, { useEffect, useState } from 'react';
import type { Thread, MemorySearchHit } from '../../../shared/types';
import { Heart } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';
import { cn } from '../../lib/utils';
import { statusColors } from '../../lib/status-colors';
import { useGroupedChunks } from '../../hooks/useGroupedChunks';
import { useMemoryInspector } from '../../hooks/useMemoryInspector';
import { useMemoryStatus } from '../../hooks/useMemoryStatus';
import { ChunkFileGroup } from './ChunkFileGroup';
import { MemoryChunkListPagination } from './MemoryChunkListPagination';
import { MemoryDetailSheet } from './MemoryDetailSheet';
import { MemoryHealthView } from './MemoryHealthView';
import { MemorySearchResultsList } from './MemorySearchResultsList';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';

interface Props {
  thread: Thread;
  source: 'sessions' | 'code';
}

type DetailSheet = 'search' | 'chunk' | null;

// 'code' is list-only — the search endpoint doesn't index code chunks
// (see MemorySearchRequest.source: 'all' | 'memory' | 'sessions'). Hide the
// search UI here rather than silently coercing to a different source.
const SEARCHABLE: Record<'sessions' | 'code', boolean> = { sessions: true, code: false };

export function ChunkSourcePanel({ thread, source }: Props) {
  const [detailSheet, setDetailSheet] = useState<DetailSheet>(null);
  const [healthOpen, setHealthOpen] = useState(false);

  const searchable = SEARCHABLE[source];
  const { query, setQuery, results, selectedEntry, doctor, busy, error, runSearch, openEntry } = useMemoryStatus(
    thread.id,
    source
  );

  const inspector = useMemoryInspector(thread.id);

  useEffect(() => {
    if (!inspector.hasLoaded) void inspector.setSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspector.hasLoaded, source]);

  const grouped = useGroupedChunks(inspector.chunks);

  const totalPages = Math.max(1, Math.ceil(inspector.total / inspector.pageSize));
  const showSearch = searchable && query.trim().length > 0;
  const healthDot = doctor != null && !doctor.ok;

  function handleOpenSearchHit(hit: MemorySearchHit) {
    void openEntry(hit);
    setDetailSheet('search');
  }

  function handleOpenChunk(chunkId: string) {
    inspector.selectChunk(chunkId);
    setDetailSheet('chunk');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        {searchable && (
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${source}…`}
              className="h-8 flex-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => void runSearch()}
              disabled={busy !== null}
            >
              Go
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground"
          onClick={() => setHealthOpen(true)}
        >
          <Heart className="h-[1em] w-[1em] shrink-0" />
          {healthDot && (
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusColors.warning.dot)} aria-hidden />
          )}
        </Button>
      </div>

      {!showSearch && (
        <div className="flex items-center gap-2 px-3 py-2">
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

      <div className="relative min-h-0 flex-1">
        <ScrollFade />
        <ScrollArea className="h-full">
          <div className="max-w-[1200px] mx-auto w-full">
            {error && <div className="px-3 py-2 text-xs text-status-error">{error}</div>}
            {inspector.error && <div className="px-3 py-2 text-xs text-status-error">{inspector.error}</div>}
            {showSearch ? (
              <MemorySearchResultsList results={results} busy={busy} onSelect={handleOpenSearchHit} />
            ) : inspector.busy ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
            ) : inspector.chunks.length === 0 ? (
              <div className="m-3 rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                No indexed chunks.
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {[...grouped.entries()].map(([filePath, fileChunks]) => (
                  <ChunkFileGroup
                    key={filePath}
                    filePath={filePath}
                    fileChunks={fileChunks}
                    selectedChunkId={inspector.selectedChunkId}
                    onSelectChunk={handleOpenChunk}
                    onDeleteFile={(path) => void inspector.deleteFile(path)}
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

      <MemoryDetailSheet
        detailSheet={detailSheet}
        selectedEntry={selectedEntry}
        inspector={inspector}
        onClose={() => setDetailSheet(null)}
      />

      <Sheet open={healthOpen} onOpenChange={setHealthOpen}>
        <SheetContent>
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 p-6 pt-10">
              <SheetTitle>Health</SheetTitle>
              <MemoryHealthView threadId={thread.id} />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
