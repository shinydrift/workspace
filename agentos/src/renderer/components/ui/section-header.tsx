import React from 'react';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-4', className)}>
      {action ? (
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{title}</p>
          {action}
        </div>
      ) : (
        <p className="text-sm font-semibold">{title}</p>
      )}
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}
