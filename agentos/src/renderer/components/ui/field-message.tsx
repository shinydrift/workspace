import React from 'react';
import { cn } from '@/lib/utils';

type FieldMessageTone = 'muted' | 'danger' | 'success' | 'warning';

const TONE_CLASS: Record<FieldMessageTone, string> = {
  muted: 'text-muted-foreground',
  danger: 'text-destructive',
  success: 'text-status-success',
  warning: 'text-status-warning',
};

interface FieldMessageProps {
  children: React.ReactNode;
  tone?: FieldMessageTone;
  className?: string;
}

export function FieldMessage({ children, tone = 'muted', className }: FieldMessageProps) {
  return <p className={cn('text-xs', TONE_CLASS[tone], className)}>{children}</p>;
}
