import * as React from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground',
        className
      )}
    >
      {icon && <div className="mb-1">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export { EmptyState };
