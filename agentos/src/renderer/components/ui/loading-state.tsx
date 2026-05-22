import * as React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

interface LoadingStateProps {
  label?: string;
  className?: string;
}

function LoadingState({ label = 'Loading…', className }: LoadingStateProps) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground', className)}
      role="status"
      aria-label={label}
    >
      <Spinner size="sm" />
      <span>{label}</span>
    </div>
  );
}

export { LoadingState };
