export const statusColors = {
  success: {
    dot: 'bg-status-success',
    badge: 'bg-status-success-muted text-status-success-foreground',
    text: 'text-status-success-foreground',
  },
  warning: {
    dot: 'bg-status-warning',
    badge: 'bg-status-warning-muted text-status-warning-foreground',
    text: 'text-status-warning-foreground',
  },
  error: {
    dot: 'bg-status-error',
    badge: 'bg-status-error-muted text-status-error-foreground',
    text: 'text-status-error-foreground',
  },
  idle: {
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
    text: 'text-muted-foreground',
  },
} as const;

import type { ThreadStatus } from '../../shared/types';

/** Border-color classes for thread status indicator dots. */
export const threadStatusDot: Record<ThreadStatus, string> = {
  running: 'border-status-success',
  building: 'border-blue-400',
  idle: 'border-status-warning',
  error: 'border-status-error',
  stopped: 'border-muted-foreground/40',
  archived: 'border-muted-foreground/40',
};
