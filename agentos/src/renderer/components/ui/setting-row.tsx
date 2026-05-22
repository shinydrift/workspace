import React from 'react';
import { cn } from '@/lib/utils';

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}

function SettingRow({ label, description, children, htmlFor, className }: SettingRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3', className)}>
      <div>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium leading-none">{label}</p>
        )}
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export { SettingRow };
