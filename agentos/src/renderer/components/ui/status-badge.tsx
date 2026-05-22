import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

const statusDotVariants = cva('shrink-0 rounded-full', {
  variants: {
    status: {
      success: 'bg-status-success',
      warning: 'bg-status-warning',
      error: 'bg-status-error',
      idle: 'bg-muted-foreground/40',
      pending: 'bg-muted-foreground/25',
    },
    size: {
      sm: 'h-1.5 w-1.5',
      md: 'h-2 w-2',
      lg: 'h-2.5 w-2.5',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusDotVariants> {
  pulse?: boolean;
  tooltip?: string;
}

function StatusDot({ className, status, size, pulse, tooltip, ...props }: StatusDotProps) {
  const dot = (
    <span
      className={cn(statusDotVariants({ status, size }), pulse && 'animate-pulse', className)}
      {...props}
      aria-hidden={tooltip ? undefined : true}
      role={tooltip ? 'img' : undefined}
      aria-label={tooltip}
    />
  );
  if (tooltip) {
    return <Tooltip content={tooltip}>{dot}</Tooltip>;
  }
  return dot;
}

const statusBadgeVariants = cva('inline-flex items-center rounded text-xs font-medium px-1.5 py-0.5', {
  variants: {
    status: {
      success: 'bg-status-success-muted text-status-success-foreground',
      warning: 'bg-status-warning-muted text-status-warning-foreground',
      error: 'bg-status-error-muted text-status-error-foreground',
      idle: 'bg-muted text-muted-foreground',
    },
  },
});

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusBadgeVariants> {}

function StatusBadge({ className, status, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ status }), className)} {...props}>
      {children}
    </span>
  );
}

export { StatusDot, StatusBadge, statusDotVariants, statusBadgeVariants };
