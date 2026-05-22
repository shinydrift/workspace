import React, { createContext, useContext } from 'react';
import type { ContainerSummary, Thread } from '../../../shared/types';

export interface ThreadListContextValue {
  // Read state
  selectedId: string | null;
  selectedProjectPath: string | null;
  menuId: string | null;
  renamingId: string | null;
  renameInput: string;
  containersByThread: Map<string, ContainerSummary>;
  childrenByParentId: Map<string, Thread[]>;
  // Actions
  setMenuId: (id: string | null) => void;
  setSelectedThread: (id: string | null) => void;
  setRenameInput: (v: string) => void;
  startRename: (t: Thread) => void;
  commitRename: (t: Thread) => void;
  cancelRename: () => void;
  stopThread: (id: string) => Promise<void>;
  archiveThread: (t: Thread) => void;
  onSelectProject: (path: string, name: string) => void;
}

const ThreadListContext = createContext<ThreadListContextValue | null>(null);

export function ThreadListProvider({ value, children }: { value: ThreadListContextValue; children: React.ReactNode }) {
  return <ThreadListContext.Provider value={value}>{children}</ThreadListContext.Provider>;
}

export function useThreadListContext(): ThreadListContextValue {
  const ctx = useContext(ThreadListContext);
  if (!ctx) throw new Error('useThreadListContext must be used inside ThreadListProvider');
  return ctx;
}
