import { create } from 'zustand';
import type { ThreadNotificationKind } from '../../shared/threadStatusLifecycle';

export interface ThreadToast {
  id: string;
  threadId: string;
  threadName: string;
  kind: ThreadNotificationKind;
}

interface ToastStore {
  toasts: ThreadToast[];
  push: (toast: Omit<ThreadToast, 'id'>) => void;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  // Keep only the most recent few so a burst of finished turns can't fill the screen.
  push: (toast) => set((state) => ({ toasts: [...state.toasts, { ...toast, id: `toast-${++seq}` }].slice(-4) })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
