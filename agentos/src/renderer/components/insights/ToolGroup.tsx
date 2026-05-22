import React, { useMemo, useState } from 'react';
import type { ToolCallStats, ToolCallInvocation } from '../../../shared/types';
import { ExpandCaret } from './ExpandCaret';
import { InvocationRow } from './InvocationRow';
import type { FilterMode } from './FilterPill';

const MCP_TOOL_RE = /^mcp__[^_]+__(.+)$/;

function formatToolName(name: string): string {
  const mcpMatch = name.match(MCP_TOOL_RE);
  const raw = mcpMatch ? mcpMatch[1] : name;
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ToolGroup({
  stat,
  invocations,
  filter,
}: {
  stat: ToolCallStats;
  invocations: ToolCallInvocation[];
  filter: FilterMode;
}) {
  const [expanded, setExpanded] = useState(false);

  const visibleInvocations = useMemo(
    () =>
      invocations.filter((inv) => {
        if (filter === 'success') return !inv.isError;
        if (filter === 'error') return inv.isError;
        return true;
      }),
    [invocations, filter]
  );

  if (visibleInvocations.length === 0 && filter !== 'all') return null;

  const successRatio = stat.count > 0 ? stat.successCount / stat.count : 0;
  const hasErrors = stat.errorCount > 0;

  return (
    <div className="min-w-0 rounded-md border border-border/50 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs bg-muted/20 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <ExpandCaret expanded={expanded} />
        <span className="text-foreground truncate flex-1 min-w-0 font-medium">{formatToolName(stat.name)}</span>
        <div className="flex items-center gap-2 shrink-0">
          {stat.errorCount > 0 && <span className="text-destructive tabular-nums text-xs">{stat.errorCount} err</span>}
          {stat.successCount > 0 && (
            <span className="text-emerald-500 tabular-nums text-xs">{stat.successCount} ok</span>
          )}
          <span className="text-muted-foreground tabular-nums text-xs w-5 text-right">{stat.count}</span>
        </div>
      </button>

      {stat.count > 0 && (
        <div className="h-[2px] w-full bg-border/40">
          <div
            className={`h-full transition-all ${hasErrors ? 'bg-emerald-500' : 'bg-emerald-500/60'}`}
            style={{ width: `${Math.round(successRatio * 100)}%` }}
          />
        </div>
      )}

      {expanded && (
        <div className="flex flex-col divide-y divide-border/30">
          {visibleInvocations.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">
              No {filter === 'success' ? 'successful' : filter === 'error' ? 'failed' : ''} invocations.
            </p>
          ) : (
            visibleInvocations.map((inv) => <InvocationRow key={inv.id} invocation={inv} />)
          )}
        </div>
      )}
    </div>
  );
}
