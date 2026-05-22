import React, { useMemo, useState } from 'react';
import type { ToolCallInvocation } from '../../../shared/types';
import { InsightSection } from './InsightSection';
import { Input } from '@/components/ui/input';

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'Glob', 'NotebookEdit']);

function relativePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/workspace\//, '');
}

function parseFilesTouched(invocations: ToolCallInvocation[]): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const inv of invocations) {
    if (!FILE_TOOLS.has(inv.name)) continue;
    const input = inv.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') continue;
    const p = (input.file_path ?? input.path) as string | undefined;
    if (typeof p !== 'string' || !p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);
}

export function FilesTouchedSection({ invocations }: { invocations: ToolCallInvocation[] }) {
  const [search, setSearch] = useState('');
  const files = useMemo(() => parseFilesTouched(invocations), [invocations]);
  const filtered = useMemo(
    () => (search ? files.filter(({ path }) => path.toLowerCase().includes(search.toLowerCase())) : files),
    [files, search]
  );
  if (files.length === 0) return null;
  return (
    <InsightSection title="Files touched" count={files.length}>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter files…"
        className="mt-1 h-7 text-xs"
      />
      <div className="flex flex-col gap-1">
        {filtered.map(({ path, count }) => (
          <div key={path} className="flex items-start gap-2.5 px-3 py-2 rounded-md text-xs bg-muted/20">
            <span className="font-mono text-foreground/80 break-all min-w-0 flex-1" title={path}>
              {relativePath(path)}
            </span>
            <span className="text-muted-foreground tabular-nums shrink-0">{count}&times;</span>
          </div>
        ))}
      </div>
    </InsightSection>
  );
}
