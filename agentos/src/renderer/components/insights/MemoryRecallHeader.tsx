interface Props {
  avgMaxScore: number | null;
  getCount: number;
  hasActivity: boolean;
  missCount: number;
  open: boolean;
  searchCount: number;
  searchesWithResults: number;
  searchesWithoutResults: number;
}

export function MemoryRecallHeader({
  avgMaxScore,
  getCount,
  hasActivity,
  missCount,
  open,
  searchCount,
  searchesWithResults,
  searchesWithoutResults,
}: Props) {
  return (
    <>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Memory Recall</span>
      {hasActivity && (
        <span className="text-xs font-normal normal-case text-muted-foreground">
          (
          {searchCount > 0 && (
            <>
              {searchCount} {searchCount === 1 ? 'search' : 'searches'}
              {open && (
                <>
                  {' '}
                  · {searchesWithResults} with results
                  {searchesWithoutResults > 0 && (
                    <>
                      {' '}
                      · <span className="text-yellow-500/70">{searchesWithoutResults} empty</span>
                    </>
                  )}
                  {avgMaxScore !== null && <> · avg {avgMaxScore.toFixed(2)}</>}
                </>
              )}
            </>
          )}
          {searchCount > 0 && getCount > 0 && ' · '}
          {getCount > 0 && (
            <>
              {getCount} {getCount === 1 ? 'read' : 'reads'}
              {missCount > 0 && (
                <>
                  {' '}
                  · <span className="text-yellow-500/70">{missCount} miss</span>
                </>
              )}
            </>
          )}
          )
        </span>
      )}
    </>
  );
}
