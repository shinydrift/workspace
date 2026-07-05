import React, { useEffect } from 'react';
import { CheckCircle, WarningCircle, ChatCircleDots, X } from '@phosphor-icons/react';
import { useToastStore, type ThreadToast } from '../../store/toastStore';
import { useUIStore } from '../../store/uiStore';
import { statusColors, notificationKindStatus } from '../../lib/status-colors';
import type { ThreadNotificationKind } from '../../../shared/threadStatusLifecycle';
import { cn } from '@/lib/utils';

const KIND_META: Record<ThreadNotificationKind, { label: string; Icon: React.ComponentType<{ className?: string }> }> =
  {
    done: { label: 'finished', Icon: CheckCircle },
    error: { label: 'failed', Icon: WarningCircle },
    attention: { label: 'needs your input', Icon: ChatCircleDots },
  };

const TOAST_TTL_MS = 5000;

function ToastCard({ toast }: { toast: ThreadToast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const setSelectedThread = useUIStore((s) => s.setSelectedThread);
  const { label, Icon } = KIND_META[toast.kind];
  const color = statusColors[notificationKindStatus[toast.kind]];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        setSelectedThread(toast.threadId);
        dismiss(toast.id);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (setSelectedThread(toast.threadId), dismiss(toast.id))}
      className="group flex w-72 cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-background/80 p-3 shadow-lg backdrop-blur-md transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', color.text)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{toast.threadName}</div>
        <div className="text-xs text-muted-foreground">Turn {label}</div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          dismiss(toast.id);
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Bottom-right stack of in-app thread notifications. */
export function ThreadToaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastCard toast={toast} />
        </div>
      ))}
    </div>
  );
}
