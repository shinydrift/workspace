import React from 'react';
import type { ThreadStatus } from '../../../shared/types';
import { StatusDot } from '@/components/ui/status-badge';
import type { StatusDotProps } from '@/components/ui/status-badge';

type StatusToken = NonNullable<StatusDotProps['status']>;

const STATUS_TOKEN: Record<ThreadStatus, StatusToken> = {
  running: 'success',
  building: 'warning',
  error: 'error',
  idle: 'idle',
  stopped: 'idle',
  archived: 'idle',
};

interface ThreadStatusDotProps {
  status: ThreadStatus;
  size?: StatusDotProps['size'];
  /** Adds animate-pulse when status is 'running'. */
  animated?: boolean;
  className?: string;
}

export function ThreadStatusDot({ status, size = 'sm', animated, className }: ThreadStatusDotProps) {
  return (
    <StatusDot
      status={STATUS_TOKEN[status]}
      size={size}
      pulse={!!animated && status === 'running'}
      className={className}
    />
  );
}
