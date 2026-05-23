import { useState } from 'react';
import type { MemoryEntryRecord, MemorySearchHit, MemorySourceFilter } from '../../shared/types';

export function useMemoryStatus(threadId: string, source: MemorySourceFilter = 'memory') {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchHit[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<MemoryEntryRecord | null>(null);
  const [busy, setBusy] = useState<'search' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    if (!query.trim()) {
      setResults([]);
      setSelectedEntry(null);
      return;
    }
    setBusy('search');
    setError(null);
    try {
      const hits = await window.electronAPI.memory.search({
        threadId,
        query,
        source,
        maxResults: 12,
      });
      setResults(hits);
      if (hits[0]) {
        const entry = await window.electronAPI.memory.get({ threadId, entryId: hits[0].id, skipExpansion: true });
        setSelectedEntry(entry);
      } else {
        setSelectedEntry(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function openEntry(hit: MemorySearchHit) {
    setBusy('search');
    setError(null);
    try {
      const entry = await window.electronAPI.memory.get({ threadId, entryId: hit.id });
      setSelectedEntry(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return {
    query,
    setQuery,
    results,
    selectedEntry,
    busy,
    error,
    runSearch,
    openEntry,
  };
}
