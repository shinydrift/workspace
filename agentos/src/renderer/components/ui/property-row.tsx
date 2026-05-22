import React from 'react';
import { cn } from '@/lib/utils';

interface PropertyRowProps {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Width of the label column. Default: 'w-16' (matches TaskPropertiesSidebar). */
  labelWidth?: string;
  /** Vertical alignment. Default: 'center'. */
  align?: 'start' | 'center';
  className?: string;
}

export function PropertyRow({ label, children, labelWidth = 'w-16', align = 'center', className }: PropertyRowProps) {
  return (
    <div className={cn('flex min-h-7 gap-1', align === 'center' ? 'items-center' : 'items-start', className)}>
      <span className={cn('shrink-0 text-[11px] text-muted-foreground', labelWidth)}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
