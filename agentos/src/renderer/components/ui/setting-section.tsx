import React from 'react';
import { cn } from '@/lib/utils';

interface SettingSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

function SettingSection({ title, description, children, className }: SettingSectionProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

export { SettingSection };
