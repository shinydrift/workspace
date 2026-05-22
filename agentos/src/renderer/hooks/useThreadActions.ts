import { useState } from 'react';
import type { Thread } from '../../shared/types';
import { useDomainStore } from '../store/domainStore';
import { useUIStore } from '../store/uiStore';

interface ThreadActionsState {
  menuId: string | null;
  setMenuId: (id: string | null) => void;
  renamingId: string | null;
  renameInput: string;
  setRenameInput: (v: string) => void;
  confirmArchiveThread: Thread | null;
  setConfirmArchiveThread: (t: Thread | null) => void;
  stopThread: (id: string) => Promise<void>;
  startRename: (t: Thread) => void;
  commitRename: (t: Thread) => Promise<void>;
  cancelRename: () => void;
  archiveThread: (t: Thread) => void;
  doArchive: (t: Thread) => Promise<void>;
}

export function useThreadActions(): ThreadActionsState {
  const { upsertThread, removeThread } = useDomainStore();
  const { setSelectedThread } = useUIStore();

  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [confirmArchiveThread, setConfirmArchiveThread] = useState<Thread | null>(null);

  async function stopThread(id: string) {
    setMenuId(null);
    await window.electronAPI.thread.stop(id);
  }

  function startRename(t: Thread) {
    setMenuId(null);
    setRenameInput(t.name);
    setRenamingId(t.id);
  }

  async function commitRename(t: Thread) {
    if (!renameInput.trim()) {
      setRenamingId(null);
      return;
    }
    const updated = await window.electronAPI.thread.rename(t.id, renameInput.trim());
    upsertThread(updated);
    setRenamingId(null);
  }

  function archiveThread(t: Thread) {
    setMenuId(null);
    setConfirmArchiveThread(t);
  }

  async function doArchive(t: Thread) {
    setConfirmArchiveThread(null);
    await window.electronAPI.thread.archive(t.id);
    removeThread(t.id);
    setSelectedThread(null);
  }

  return {
    menuId,
    setMenuId,
    renamingId,
    renameInput,
    setRenameInput,
    confirmArchiveThread,
    setConfirmArchiveThread,
    stopThread,
    startRename,
    commitRename,
    cancelRename: () => setRenamingId(null),
    archiveThread,
    doArchive,
  };
}
