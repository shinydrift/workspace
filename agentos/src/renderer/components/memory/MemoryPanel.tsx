import React, { useEffect, useState } from 'react';
import type { Thread, MemorySearchHit } from '../../../shared/types';
import { useMemoryStatus } from '../../hooks/useMemoryStatus';
import { useMemoryInspector } from '../../hooks/useMemoryInspector';
import { MemoryDetailSheet } from './MemoryDetailSheet';
import { MemoryHealthView } from './MemoryHealthView';
import { MemoryPanelBody } from './MemoryPanelBody';
import { MemoryPanelHeader } from './MemoryPanelHeader';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  thread: Thread;
}

type DetailSheet = 'search' | 'chunk' | null;

export function MemoryPanel({ thread }: Props) {
  const [detailSheet, setDetailSheet] = useState<DetailSheet>(null);
  const [healthOpen, setHealthOpen] = useState(false);

  const { query, setQuery, results, selectedEntry, doctor, busy, error, runSearch, openEntry } = useMemoryStatus(
    thread.id
  );

  const inspector = useMemoryInspector(thread.id);

  useEffect(() => {
    if (!inspector.hasLoaded) void inspector.setSource('memory');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspector.hasLoaded]);

  function handleOpenSearchHit(hit: MemorySearchHit) {
    void openEntry(hit);
    setDetailSheet('search');
  }

  function handleOpenChunk(chunkId: string) {
    inspector.selectChunk(chunkId);
    setDetailSheet('chunk');
  }

  const showSearch = query.trim().length > 0;
  const healthDot = doctor != null && !doctor.ok;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MemoryPanelHeader
        query={query}
        onQueryChange={setQuery}
        onSearch={() => void runSearch()}
        busy={busy}
        onOpenHealth={() => setHealthOpen(true)}
        healthDot={healthDot}
      />

      <MemoryPanelBody
        showSearch={showSearch}
        results={results}
        busy={busy}
        error={error}
        inspector={inspector}
        onOpenSearchHit={handleOpenSearchHit}
        onOpenChunk={handleOpenChunk}
      />

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
