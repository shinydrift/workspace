import { useCallback, useEffect, useState } from 'react';
import type { CouncilConfig, CouncilMember, Provider } from '../../../shared/types';

export interface CouncilDraft {
  id?: string;
  name: string;
  members: CouncilMember[];
}

function emptyDraft(): CouncilDraft {
  return {
    name: '',
    members: [
      { provider: 'claude' as Provider, model: '' },
      { provider: 'codex' as Provider, model: '' },
    ],
  };
}

export function useCouncilConfigs() {
  const [configs, setConfigs] = useState<CouncilConfig[]>([]);
  const [draft, setDraft] = useState<CouncilDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.council) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.council.listConfigs();
      setConfigs(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startNew = () => setDraft(emptyDraft());
  const startEdit = (cfg: CouncilConfig) =>
    setDraft({ id: cfg.id, name: cfg.name, members: cfg.members.map((m) => ({ ...m })) });
  const cancelDraft = () => {
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Name is required');
      return;
    }
    if (draft.members.length === 0) {
      setError('At least one member is required');
      return;
    }
    try {
      await window.electronAPI.council.upsertConfig({
        id: draft.id,
        name: draft.name.trim(),
        members: draft.members,
      });
      setDraft(null);
      setError(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await window.electronAPI.council.deleteConfig(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setDraftName = (name: string) => setDraft((d) => (d ? { ...d, name } : d));
  const addMember = () =>
    setDraft((d) => (d ? { ...d, members: [...d.members, { provider: 'claude' as Provider, model: '' }] } : d));
  const removeMember = (idx: number) =>
    setDraft((d) => (d ? { ...d, members: d.members.filter((_, i) => i !== idx) } : d));
  const updateMember = (idx: number, patch: Partial<CouncilMember>) =>
    setDraft((d) => (d ? { ...d, members: d.members.map((m, i) => (i === idx ? { ...m, ...patch } : m)) } : d));

  return {
    configs,
    draft,
    loading,
    error,
    startNew,
    startEdit,
    cancelDraft,
    save,
    remove,
    setDraftName,
    addMember,
    removeMember,
    updateMember,
  };
}
