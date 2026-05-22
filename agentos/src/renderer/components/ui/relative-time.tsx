import React from 'react';
import { cn, relativeTime } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

interface RelativeTimeProps {
  value: number | string | Date;
  /** Show absolute date/time in a tooltip. Default: true. */
  tooltip?: boolean;
  className?: string;
}

export function RelativeTime({ value, tooltip = true, className }: RelativeTimeProps) {
  const ts = typeof value === 'number' ? value : new Date(value).getTime();
  const relative = relativeTime(ts);
  const absolute = new Date(ts).toLocaleString();

  const text = <span className={cn('text-xs text-muted-foreground tabular-nums', className)}>{relative}</span>;

  if (tooltip) {
    return <Tooltip content={absolute}>{text}</Tooltip>;
  }
  return text;
}
