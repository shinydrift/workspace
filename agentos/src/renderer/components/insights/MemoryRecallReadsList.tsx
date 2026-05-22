import type { GetCallEntry } from './memoryRecallParser';

export function MemoryRecallReadsList({ calls }: { calls: GetCallEntry[] }) {
  if (calls.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {calls.map((call, index) => (
        <div key={index} className="flex items-start gap-2.5 px-3 py-2 rounded-md bg-muted/20 text-xs">
          <span
            className={`shrink-0 font-mono text-[10px] mt-0.5 ${call.hit ? 'text-emerald-400' : 'text-yellow-500/70'}`}
          >
            {call.hit ? 'hit' : 'miss'}
          </span>
          <span className="flex-1 font-mono text-foreground/80 break-words min-w-0">{call.target}</span>
        </div>
      ))}
    </div>
  );
}
