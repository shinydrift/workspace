import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  delta?: { label: string; positive: boolean | null };
}

export function StatCard({ label, value, delta }: StatCardProps) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2.5">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-base font-medium tabular-nums text-foreground">{value}</p>
      {delta && (
        <p
          className={cn(
            'text-xs tabular-nums mt-0.5',
            delta.positive === null ? 'text-muted-foreground/60' : delta.positive ? 'text-emerald-500' : 'text-red-500'
          )}
        >
          {delta.label} vs prev 7 days
        </p>
      )}
    </div>
  );
}
