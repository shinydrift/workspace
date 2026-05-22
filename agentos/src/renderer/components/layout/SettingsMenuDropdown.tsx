import React, { useMemo, useRef } from 'react';
import { Gear } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useLogsStore } from '../../store/index';
import type { HealthCheck } from '../../../shared/types';

interface Props {
  onOpenSettings: () => void;
  healthStatus?: HealthCheck['status'] | null;
}

export function SettingsMenuDropdown({ onOpenSettings, healthStatus }: Props) {
  const logs = useLogsStore((s) => s.logs);
  const mountTs = useRef(Date.now()).current;

  const dotColor = useMemo(() => {
    let hasError = healthStatus === 'error';
    let hasWarn = healthStatus === 'warn';
    for (const l of logs) {
      if (l.ts <= mountTs) continue;
      if (l.level === 'error') hasError = true;
      else if (l.level === 'warn') hasWarn = true;
      if (hasError) break;
    }
    return hasError ? 'bg-status-error' : hasWarn ? 'bg-status-warning' : null;
  }, [logs, mountTs, healthStatus]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative h-8 w-8 hover:bg-black/10 dark:hover:bg-white/10"
      onClick={onOpenSettings}
      aria-label="Open settings"
    >
      <Gear className="h-5 w-5" />
      {dotColor && <span className={cn('absolute top-1 right-1 w-2 h-2 rounded-full', dotColor)} />}
    </Button>
  );
}
