import { cn } from '@/lib/utils';
import type { ProviderRateLimitsEntry } from '../../../shared/types';
import { MiniBar } from './MiniBar';
import { PROVIDER_LABEL } from '../../../shared/types/provider';

interface WindowBarProps {
  label: string;
  usedPercentage: number;
  resetsAt: number; // unix seconds (0 = unknown)
}

function WindowBar({ label, usedPercentage, resetsAt }: WindowBarProps) {
  const remaining = Math.max(0, 100 - usedPercentage);
  const resetsIn = resetsAt > 0 ? Math.max(0, resetsAt * 1000 - Date.now()) : null;
  const resetLabel =
    resetsIn !== null
      ? (() => {
          const minutes = Math.round(resetsIn / 60_000);
          const totalHours = Math.floor(minutes / 60);
          const mins = minutes % 60;
          const days = Math.floor(totalHours / 24);
          const hours = totalHours % 24;
          if (days > 0) return `${days}d ${hours}h ${mins}m`;
          return totalHours > 0 ? `${totalHours}h ${mins}m` : `${mins}m`;
        })()
      : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">
          {remaining.toFixed(0)}% remaining{resetLabel ? ` · resets in ${resetLabel}` : ''}
        </span>
      </div>
      <MiniBar
        segments={[
          {
            value: Math.min(100, usedPercentage),
            className: cn(
              'rounded-full transition-all',
              usedPercentage >= 90 ? 'bg-red-500' : usedPercentage >= 70 ? 'bg-amber-400' : 'bg-primary'
            ),
          },
        ]}
        trackClassName="bg-muted"
      />
    </div>
  );
}

interface Props {
  rateLimits: Record<string, ProviderRateLimitsEntry>;
}

export function ProviderRateLimitsSection({ rateLimits }: Props) {
  const entries = Object.entries(rateLimits);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-foreground">Rate Limits</p>
      {entries.map(([provider, entry]) => {
        if (entry.windows.length === 0) return null;
        return (
          <div
            key={provider}
            className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 flex flex-col gap-2"
          >
            <p className="text-xs font-medium text-foreground">
              {PROVIDER_LABEL[provider as keyof typeof PROVIDER_LABEL] ?? provider}
            </p>
            {entry.windows.map((w) => (
              <WindowBar key={w.label} label={w.label} usedPercentage={w.usedPercentage} resetsAt={w.resetsAt} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
