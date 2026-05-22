import React from 'react';
import { cn } from '@/lib/utils';

export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

interface DueDateBadgeProps {
  dueAt: number;
}

export function DueDateBadge({ dueAt }: DueDateBadgeProps) {
  const now = Date.now();
  const overdue = dueAt < now;
  const dueSoon = !overdue && dueAt - now < DUE_SOON_MS;

  if (!overdue && !dueSoon) return null;

  const daysAgo = overdue ? Math.ceil((now - dueAt) / (24 * 60 * 60 * 1000)) : 0;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold leading-none',
        overdue ? 'bg-destructive text-destructive-foreground' : 'bg-yellow-500 text-black'
      )}
      title={`Due ${new Date(dueAt).toLocaleDateString()}`}
    >
      {overdue ? `Overdue ${daysAgo}d` : 'Due soon'}
    </span>
  );
}
