import { useEffect, useState } from 'react';
import type { CouncilRun, CouncilOutcomeRecord } from '../../shared/types';

export type CouncilRunEntry = {
  run: CouncilRun;
  outcomes: CouncilOutcomeRecord[];
  memberCount: number;
};

export function useCouncilRuns(threadId: string | null): CouncilRunEntry[] {
  const [entries, setEntries] = useState<CouncilRunEntry[]>([]);

  // Load existing runs when thread changes
  useEffect(() => {
    if (!threadId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    window.electronAPI.council.listRunsByThread(threadId).then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Subscribe to push events
  useEffect(() => {
    if (!threadId) return;

    const unsubRun = window.electronAPI.on.councilRunUpdated((run) => {
      if (run.parentThreadId !== threadId) return;
      window.electronAPI.council.listRunsByThread(threadId).then(setEntries);
    });

    const unsubOutcome = window.electronAPI.on.councilOutcomeSubmitted(({ runId, outcome }) => {
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.run.id === runId);
        if (idx === -1) return prev;
        const entry = prev[idx];
        // Dedup by childThreadId
        if (entry.outcomes.some((o) => o.childThreadId === outcome.childThreadId)) return prev;
        const updated = [...prev];
        updated[idx] = { ...entry, outcomes: [...entry.outcomes, outcome] };
        return updated;
      });
    });

    return () => {
      unsubRun();
      unsubOutcome();
    };
  }, [threadId]);

  return entries;
}
