import React, { useMemo } from 'react';
import { Globe, MagnifyingGlass } from '@phosphor-icons/react';
import { InsightSection } from './InsightSection';
import type { ToolCallInvocation } from '../../../shared/types';

interface WebEntry {
  type: 'search' | 'fetch';
  value: string;
}

function parseWebActivity(invocations: ToolCallInvocation[]): WebEntry[] {
  const entries: WebEntry[] = [];
  for (const inv of invocations) {
    const input = inv.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') continue;
    if (inv.name === 'WebSearch' && typeof input.query === 'string') {
      entries.push({ type: 'search', value: input.query });
    } else if (inv.name === 'WebFetch' && typeof input.url === 'string') {
      entries.push({ type: 'fetch', value: input.url });
    }
  }
  return entries;
}

export function WebActivitySection({ invocations }: { invocations: ToolCallInvocation[] }) {
  const entries = useMemo(() => parseWebActivity(invocations), [invocations]);
  if (entries.length === 0) return null;
  return (
    <InsightSection title="Web activity" count={entries.length}>
      <div className="flex flex-col gap-1">
        {entries.map(({ type, value }, i) => (
          <div
            key={`${type}-${i}-${value.slice(0, 30)}`}
            className="flex items-start gap-2.5 px-3 py-2 rounded-md text-xs bg-muted/20"
          >
            {type === 'search' ? (
              <MagnifyingGlass className="h-3 w-3 shrink-0 text-muted-foreground/60 mt-0.5" />
            ) : (
              <Globe className="h-3 w-3 shrink-0 text-muted-foreground/60 mt-0.5" />
            )}
            {type === 'fetch' ? (
              <button
                className="text-foreground/80 break-words min-w-0 text-left hover:underline cursor-pointer"
                onClick={() => window.electronAPI?.shell.openExternal(value)}
              >
                {value}
              </button>
            ) : (
              <span className="text-foreground/80 break-words min-w-0">{value}</span>
            )}
          </div>
        ))}
      </div>
    </InsightSection>
  );
}
