import React, { useEffect, useState } from 'react';
import type { MemorySearchHit, MemorySourceFilter, Thread } from '../../../shared/types';
import { useMemoryInspector } from '../../hooks/useMemoryInspector';
import { useMemoryStatus } from '../../hooks/useMemoryStatus';
import { MemoryDetailSheet } from './MemoryDetailSheet';
import { MemoryPanelBody } from './MemoryPanelBody';
import { MemoryPanelHeader } from './MemoryPanelHeader';

interface Props {
  thread: Thread;
  source: MemorySourceFilter;
}

type DetailSheet = 'search' | 'chunk' | null;

export function MemorySourcePanel({ thread, source }: Props) {
  const [detailSheet, setDetailSheet] = useState<DetailSheet>(null);

  const { query, setQuery, results, selectedEntry, busy, error, runSearch, openEntry } = useMemoryStatus(
    thread.id,
    source
  );

  const inspector = useMemoryInspector(thread.id);
  const { setSource: inspectorSetSource } = inspector;

  useEffect(() => {
    void inspectorSetSource(source);
  }, [inspectorSetSource, source]);

  const showSearch = query.trim().length > 0;

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
      <MemoryPanelHeader
        source={source}
        query={query}
        onQueryChange={setQuery}
        onSearch={() => void runSearch()}
        busy={busy}
      />

      <MemoryPanelBody
        source={source}
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
    </div>
  );
}
