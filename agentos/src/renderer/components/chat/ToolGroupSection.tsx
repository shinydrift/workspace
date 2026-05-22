import React, { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { DisclosureSection } from '@/components/ui/disclosure-section';
import { ToolCard } from './ToolCard';
import type { ToolPair } from './messageUtils';

export function ToolGroupSection({
  tools,
  title,
  isLatest,
  allowPending = true,
}: {
  tools: ToolPair[];
  title: string;
  isLatest: boolean;
  allowPending?: boolean;
}) {
  const [expanded, setExpanded] = useState(isLatest);
  const hasPending = allowPending && tools.some((tool) => !tool.result);

  // Auto-collapse when this is no longer the latest message
  useEffect(() => {
    if (!isLatest) setExpanded(false);
  }, [isLatest]);

  return (
    <DisclosureSection
      open={expanded}
      onOpenChange={setExpanded}
      trigger={
        <>
          {/* Spinner for pending only — no ✓ checkmark for completed (matches Claude Desktop) */}
          {hasPending && <Spinner size="sm" className="shrink-0" aria-label="Waiting on tool result" />}
          <span className="min-w-0 truncate max-w-[64ch]">{title}</span>
        </>
      }
      className="my-1 w-full"
      triggerClassName="text-xs text-foreground/65 hover:text-foreground/90 transition-colors"
      contentClassName="mt-0.5 ml-3 space-y-0"
    >
      {tools.map((t, i) => (
        <ToolCard
          key={i}
          name={t.use.name}
          args={t.use.input}
          result={t.result?.content}
          isError={t.result?.isError}
          pending={allowPending && !t.result}
        />
      ))}
    </DisclosureSection>
  );
}
