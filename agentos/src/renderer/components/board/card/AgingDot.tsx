import React from 'react';
import { StatusDot } from '@/components/ui/status-badge';

interface AgingDotProps {
  level: 'warn' | 'crit';
}

export function AgingDot({ level }: AgingDotProps) {
  return <StatusDot status={level === 'crit' ? 'error' : 'warning'} size="sm" className="absolute top-2 right-2" />;
}
