import { create } from 'zustand';
import type { AppLogEntry } from '../../shared/types';

const MAX_APP_LOG_ENTRIES = 1000;

interface LogsStore {
  logs: AppLogEntry[];

  setLogs: (logs: AppLogEntry[]) => void;
  addLog: (entry: AppLogEntry) => void;
  addLogs: (entries: AppLogEntry[]) => void;
  clearLogs: () => void;
}

export const useLogsStore = create<LogsStore>((set) => ({
  logs: [],

  setLogs: (logs) => set({ logs: logs.slice(-MAX_APP_LOG_ENTRIES) }),

  addLog: (entry) =>
    set((state) => ({
      logs:
        state.logs.length >= MAX_APP_LOG_ENTRIES
          ? [...state.logs.slice(-(MAX_APP_LOG_ENTRIES - 1)), entry]
          : [...state.logs, entry],
    })),

  addLogs: (entries) =>
    set((state) => {
      if (entries.length === 0) return state;
      const combined = [...state.logs, ...entries];
      return { logs: combined.length > MAX_APP_LOG_ENTRIES ? combined.slice(-MAX_APP_LOG_ENTRIES) : combined };
    }),

  clearLogs: () => set({ logs: [] }),
}));
