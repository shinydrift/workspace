import { create } from 'zustand';
import type { KanbanTask, KanbanTaskNote, KanbanWipLimit } from '../../shared/types/kanban';

interface BoardState {
  tasks: KanbanTask[];
  notes: Record<string, KanbanTaskNote[]>; // taskId → notes
  wipLimits: KanbanWipLimit[];
  loading: boolean;
  error: string | null;

  // Actions
  setTasks: (tasks: KanbanTask[]) => void;
  upsertTask: (task: KanbanTask) => void;
  removeTask: (taskId: string) => void;
  setNotes: (taskId: string, notes: KanbanTaskNote[]) => void;
  setWipLimits: (limits: KanbanWipLimit[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  tasks: [],
  notes: {},
  wipLimits: [],
  loading: false,
  error: null,

  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) =>
    set((state) => ({
      tasks: state.tasks.some((t) => t.id === task.id)
        ? state.tasks.map((t) => (t.id === task.id ? task : t))
        : [...state.tasks, task],
    })),
  removeTask: (taskId) => set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) })),
  setNotes: (taskId, notes) => set((state) => ({ notes: { ...state.notes, [taskId]: notes } })),
  setWipLimits: (limits) => set({ wipLimits: limits }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

// Selector helpers
export function selectTasksByStatus(tasks: KanbanTask[], status: string): KanbanTask[] {
  return tasks.filter((t) => t.status === status);
}

export function selectWipLimit(limits: KanbanWipLimit[], status: string): number | null {
  return limits.find((l) => l.status === status)?.maxTasks ?? null;
}
