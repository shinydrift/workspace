import { create } from 'zustand';
import type { Thread, ThreadStatus, AutomationJob, SavedProject } from '../../shared/types';
import { useUIStore } from './uiStore';

interface DomainStore {
  threads: Record<string, Thread>;
  threadsLoaded: boolean;
  automations: AutomationJob[];
  projects: Record<string, SavedProject>;

  setThreads: (threads: Thread[]) => void;
  upsertThread: (thread: Thread) => void;
  removeThread: (id: string) => void;
  updateThreadStatus: (id: string, status: ThreadStatus, extra?: Partial<Thread>) => void;
  renameThread: (id: string, name: string) => void;
  setAutomations: (jobs: AutomationJob[]) => void;
  upsertAutomation: (job: AutomationJob) => void;
  removeAutomation: (id: string) => void;
  setProjects: (projects: SavedProject[]) => void;
  upsertProject: (project: SavedProject) => void;
  removeProject: (id: string) => void;
}

export const useDomainStore = create<DomainStore>((set) => ({
  threads: {},
  threadsLoaded: false,
  automations: [],
  projects: {},

  setThreads: (threads) => set({ threads: Object.fromEntries(threads.map((t) => [t.id, t])), threadsLoaded: true }),

  upsertThread: (thread) => set((state) => ({ threads: { ...state.threads, [thread.id]: thread } })),

  removeThread: (id) =>
    set((state) => {
      const threads = { ...state.threads };
      delete threads[id];
      if (useUIStore.getState().selectedThreadId === id) {
        useUIStore.getState().setSelectedThread(null);
      }
      return { threads };
    }),

  updateThreadStatus: (id, status, extra = {}) =>
    set((state) => {
      const thread = state.threads[id];
      if (!thread) return state;
      return {
        threads: { ...state.threads, [id]: { ...thread, status, ...extra } },
      };
    }),

  renameThread: (id, name) =>
    set((state) => {
      const thread = state.threads[id];
      if (!thread) return state;
      return { threads: { ...state.threads, [id]: { ...thread, name } } };
    }),

  setProjects: (projects) => set({ projects: Object.fromEntries(projects.map((p) => [p.id, p])) }),

  upsertProject: (project) => set((state) => ({ projects: { ...state.projects, [project.id]: project } })),

  removeProject: (id) =>
    set((state) => {
      const projects = { ...state.projects };
      delete projects[id];
      return { projects };
    }),

  setAutomations: (jobs) => set({ automations: jobs }),

  upsertAutomation: (job) =>
    set((state) => ({
      automations: [job, ...state.automations.filter((item) => item.id !== job.id)],
    })),

  removeAutomation: (id) =>
    set((state) => ({
      automations: state.automations.filter((item) => item.id !== id),
    })),
}));
