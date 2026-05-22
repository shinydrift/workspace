import React from 'react';
import { cn } from '@/lib/utils';

interface ListProps {
  children: React.ReactNode;
  className?: string;
  empty?: boolean;
  emptyText?: string;
}

export function List({ children, className, empty, emptyText = 'No items.' }: ListProps) {
  return (
    <div
      className={cn('rounded-lg border border-border/60 divide-y divide-border/40 overflow-hidden text-xs', className)}
    >
      {empty ? <p className="px-3 py-2 text-muted-foreground">{emptyText}</p> : children}
    </div>
  );
}

interface ListItemProps {
  children: React.ReactNode;
  className?: string;
}

export function ListItem({ children, className }: ListItemProps) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 hover:bg-accent/40 transition-colors', className)}>
      {children}
    </div>
  );
}
