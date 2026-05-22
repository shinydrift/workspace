import { useEffect, useMemo, useState } from 'react';
import type {
  MemoryDoctorResult,
  MemoryEntryRecord,
  MemoryIndexStatus,
  MemorySearchHit,
  MemorySourceFilter,
} from '../../shared/types';

const DEFAULT_STATUS: MemoryIndexStatus = {
  projectId: '',
  cachePath: '',
  builtAt: null,
  hasMemoryFiles: false,
  hasSessionHistory: false,
  memoryFileCount: 0,
  sessionFileCount: 0,
  entryCount: 0,
  sources: [],
  embeddingProvider: null,
  embeddingModel: null,
  embeddingDimensions: null,
};

const DEFAULT_DOCTOR: MemoryDoctorResult = {
  ok: false,
  issues: [],
  checks: [],
};

export function useMemoryStatus(threadId: string, initialSource: MemorySourceFilter = 'memory') {
  const [status, setStatus] = useState<MemoryIndexStatus>(DEFAULT_STATUS);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<MemorySourceFilter>(initialSource);
  const [results, setResults] = useState<MemorySearchHit[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<MemoryEntryRecord | null>(null);
  const [savePath, setSavePath] = useState('memory/notes.md');
  const [saveContent, setSaveContent] = useState('');
  const [saveMode, setSaveMode] = useState<'overwrite' | 'append'>('append');
  const [doctor, setDoctor] = useState<MemoryDoctorResult>(DEFAULT_DOCTOR);
  const [busy, setBusy] = useState<'status' | 'search' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  async function refreshStatus(reindex = false) {
    setBusy('status');
    setError(null);
    try {
      const statusPromise = reindex
        ? window.electronAPI.memory.reindex(threadId)
        : window.electronAPI.memory.status(threadId);
      const [next, doc] = await Promise.all([statusPromise, window.electronAPI.memory.doctor(threadId)]);
      setStatus(next);
      setDoctor(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  async function runSearch() {
    if (!query.trim()) {
      setResults([]);
      setSelectedEntry(null);
      return;
    }
    if (source === 'code') {
      // 'code' is list-only — callers must hide the search UI for code (see
      // ChunkSourcePanel's SEARCHABLE map). Surface as an error rather than
      // silently coercing to a different source.
      setError('Search is not available for code chunks.');
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
        const entry = await window.electronAPI.memory.get({ threadId, entryId: hits[0].id });
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

  async function saveMemory() {
    if (!savePath.trim() || !saveContent.trim()) return;
    setBusy('save');
    setError(null);
    setSaveMessage(null);
    try {
      const result = await window.electronAPI.memory.save({
        threadId,
        path: savePath,
        content: saveContent,
        mode: saveMode,
      });
      setSaveMessage(`Saved ${result.bytesWritten} bytes to ${savePath}`);
      setSaveContent('');
      await refreshStatus(true);
      if (query.trim()) {
        await runSearch();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const builtAtLabel = useMemo(() => {
    if (!status.builtAt) return 'Not built yet';
    return new Date(status.builtAt).toLocaleString();
  }, [status.builtAt]);

  return {
    status,
    query,
    setQuery,
    source,
    setSource,
    results,
    selectedEntry,
    savePath,
    setSavePath,
    saveContent,
    setSaveContent,
    saveMode,
    setSaveMode,
    doctor,
    busy,
    error,
    saveMessage,
    builtAtLabel,
    refreshStatus,
    runSearch,
    openEntry,
    saveMemory,
  };
}
