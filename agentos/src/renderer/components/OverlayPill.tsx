import React from 'react';
import { cn } from '@/lib/utils';

interface OverlayPillProps {
  children: React.ReactNode;
  className?: string;
}

export function OverlayPill({ children, className }: OverlayPillProps) {
  return (
    <div
      className={cn(
        'fixed left-1/2 top-1/2 z-50 inline-flex h-10 -translate-x-1/2 -translate-y-1/2 select-none items-center gap-3 rounded-full bg-neutral-900 px-4 text-white shadow-lg',
        className
      )}
    >
      {children}
    </div>
  );
}
