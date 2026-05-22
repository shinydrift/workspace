import React from 'react';
import { cn } from '@/lib/utils';

interface PanelHeaderProps {
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

function PanelHeader({ title, icon, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn('h-11 px-4 flex items-center justify-between shrink-0', className)}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-muted-foreground">{title}</span>
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

function PanelToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-1', className)}>{children}</div>;
}

export { PanelHeader, PanelToolbar };
