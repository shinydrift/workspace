const CACHE_COLOR = 'rgba(251,191,36,0.7)';

export function TokenRatioBar({
  uniqueIn,
  cacheRead,
  output,
}: {
  uniqueIn: number;
  cacheRead: number;
  output: number;
}) {
  const total = uniqueIn + cacheRead + output;
  if (total === 0) return null;

  const pct = (n: number) => Math.round((n / total) * 100);
  const uniqueInPct = pct(uniqueIn);
  const cacheReadPct = pct(cacheRead);

  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
      <div className="h-2 w-full rounded-full overflow-hidden flex bg-border/30">
        <div className="h-full bg-primary/70 transition-all" style={{ width: `${uniqueInPct}%` }} />
        <div className="h-full transition-all" style={{ width: `${cacheReadPct}%`, background: CACHE_COLOR }} />
        <div className="h-full bg-emerald-500/70 transition-all flex-1" />
      </div>
      <div className="flex items-center text-xs text-muted-foreground flex-wrap gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-primary/70" />
          Unique in {uniqueInPct}%
        </span>
        {cacheReadPct > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CACHE_COLOR }} />
            Cache hits {cacheReadPct}%
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" />
          Out {pct(output)}%
        </span>
      </div>
    </div>
  );
}
