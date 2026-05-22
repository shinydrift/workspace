import React from 'react';
import { Lock } from '@phosphor-icons/react';

interface BlockerBadgeProps {
  count: number;
}

export function BlockerBadge({ count }: BlockerBadgeProps) {
  return (
    <span className="flex items-center gap-0.5 text-yellow-500" title={`Blocked by ${count} task(s)`}>
      <Lock size={10} weight="fill" />
      <span className="text-xs font-mono">{count}</span>
    </span>
  );
}
