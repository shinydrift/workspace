import { create } from 'zustand';
import type { ThreadStatus } from '../../shared/types';

export type ThreadFilter = {
  query: string;
  status: 'all' | ThreadStatus;
  sortBy: 'newest' | 'last-active' | 'name';
};

export interface PendingTranscript {
  text: string;
  /** When true, the consuming component should auto-send instead of just inserting. */
  autoSubmit: boolean;
  /** When true, route to NewThreadComposer (start new thread); otherwise to active thread's PromptInput. */
  newThread: boolean;
}

interface UIStore {
  selectedThreadId: string | null;
  threadView: 'thread' | 'chat' | 'terminal';
  sandboxBuildProgress: string | null;
  memoryIndexProgress: string | null;
  threadFilter: ThreadFilter;
  devMode: boolean;
  editor: { label: string; command: string } | null;
  pendingTranscript: PendingTranscript | null;
  updateReady: { releaseName: string } | null;

  setSelectedThread: (id: string | null) => void;
  setThreadView: (view: 'thread' | 'chat' | 'terminal') => void;
  setSandboxBuildProgress: (msg: string | null) => void;
  setMemoryIndexProgress: (msg: string | null) => void;
  setThreadFilter: (patch: Partial<ThreadFilter>) => void;
  setDevMode: (value: boolean) => void;
  setEditor: (value: { label: string; command: string } | null) => void;
  setPendingTranscript: (value: PendingTranscript | null) => void;
  setUpdateReady: (value: { releaseName: string } | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selectedThreadId: null,
  threadView: 'thread',
  sandboxBuildProgress: null,
  memoryIndexProgress: null,
  threadFilter: { query: '', status: 'all', sortBy: 'newest' },
  devMode: false,
  editor: null,
  pendingTranscript: null,
  updateReady: null,

  setSelectedThread: (id) => set({ selectedThreadId: id }),
  setThreadView: (view) => set({ threadView: view }),
  setSandboxBuildProgress: (msg) => set({ sandboxBuildProgress: msg }),
  setMemoryIndexProgress: (msg) => set({ memoryIndexProgress: msg }),
  setThreadFilter: (patch) => set((state) => ({ threadFilter: { ...state.threadFilter, ...patch } })),
  setDevMode: (value) => set({ devMode: value }),
  setEditor: (value) => set({ editor: value }),
  setPendingTranscript: (value) => set({ pendingTranscript: value }),
  setUpdateReady: (value) => set({ updateReady: value }),
}));
