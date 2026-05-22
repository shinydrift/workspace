import React, { useMemo, useState } from 'react';
import type { ToolCallInvocation } from '../../../shared/types';
import { InsightSection } from './InsightSection';
import { Input } from '@/components/ui/input';

function parseCommands(invocations: ToolCallInvocation[]): string[] {
  const commands: string[] = [];
  for (const inv of invocations) {
    if (inv.name !== 'Bash') continue;
    const input = inv.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') continue;
    if (typeof input.command !== 'string') continue;
    const cmd = input.command.trim();
    if (cmd) commands.push(cmd);
  }
  return commands;
}

export function CommandsSection({ invocations }: { invocations: ToolCallInvocation[] }) {
  const [search, setSearch] = useState('');
  const commands = useMemo(() => parseCommands(invocations), [invocations]);
  const filtered = useMemo(
    () => (search ? commands.filter((cmd) => cmd.toLowerCase().includes(search.toLowerCase())) : commands),
    [commands, search]
  );
  if (commands.length === 0) return null;
  return (
    <InsightSection title="Shell commands" count={commands.length}>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter commands…"
        className="mt-1 h-7 text-xs"
      />
      <div className="flex flex-col gap-1">
        {filtered.map((cmd, i) => (
          <div
            key={`${i}-${cmd.slice(0, 30)}`}
            className="text-xs font-mono text-foreground/80 bg-muted/20 rounded-md px-3 py-2 whitespace-pre-wrap break-words min-w-0 leading-relaxed"
          >
            {cmd}
          </div>
        ))}
      </div>
    </InsightSection>
  );
}
