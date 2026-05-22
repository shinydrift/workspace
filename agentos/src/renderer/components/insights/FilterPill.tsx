import React from 'react';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FilterMode = 'all' | 'success' | 'error';

export function FilterPill({
  active,
  onClick,
  label,
  count,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  variant?: 'success' | 'error';
}) {
  const colorMap = {
    success: active
      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
      : 'bg-transparent border-border/50 text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-400',
    error: active
      ? 'bg-destructive/15 border-destructive/40 text-destructive'
      : 'bg-transparent border-border/50 text-muted-foreground hover:border-destructive/30 hover:text-destructive',
    default: active
      ? 'bg-muted/60 border-border text-foreground'
      : 'bg-transparent border-border/50 text-muted-foreground hover:border-border hover:text-foreground',
  };
  const colorClass = colorMap[variant ?? 'default'];
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn('flex items-center gap-1 rounded-full text-xs font-medium h-auto px-2.5 py-1 border', colorClass)}
    >
      {variant === 'success' && <CheckCircle className="h-3 w-3" weight="fill" />}
      {variant === 'error' && <XCircle className="h-3 w-3" weight="fill" />}
      {label}
      <span className="opacity-60 tabular-nums">{count}</span>
    </Button>
  );
}
