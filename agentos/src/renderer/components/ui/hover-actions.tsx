import React from 'react';
import { cn } from '@/lib/utils';

interface HoverActionsProps {
  children?: React.ReactNode;
  actions: React.ReactNode;
  forceVisible?: boolean;
  variant?: 'overlay' | 'inline';
  className?: string;
  actionsClassName?: string;
}

export function HoverActions({
  children,
  actions,
  forceVisible = false,
  variant = 'overlay',
  className,
  actionsClassName,
}: HoverActionsProps) {
  return (
    <div className={cn('group relative flex items-center', className)}>
      {children}
      {actions != null && (
        <div
          className={cn(
            'flex items-center gap-0.5 transition-opacity duration-75',
            variant === 'overlay' &&
              'absolute right-0 bg-background/90 backdrop-blur-sm border border-border/50 rounded-md px-1 py-0.5',
            variant === 'inline' && 'shrink-0',
            forceVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            actionsClassName
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
