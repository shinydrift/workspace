import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function ContentCard({ children, className }: Props) {
  return (
    <div className="flex flex-col h-full bg-background p-3">
      <div
        className={cn(
          'flex flex-col flex-1 min-h-0 rounded-xl bg-card shadow-sm border border-border/40 overflow-hidden',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
