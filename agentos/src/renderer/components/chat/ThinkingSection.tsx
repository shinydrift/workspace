import React, { memo, useMemo, useState } from 'react';
import { extractStreamText } from '../../lib/streamParsers';
import { DisclosureSection } from '@/components/ui/disclosure-section';

export const ThinkingSection = memo(function ThinkingSection({
  text,
  defaultExpanded = false,
}: {
  text: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { cleaned, firstLine } = useMemo(() => {
    const c = (extractStreamText(text) ?? text).trim();
    return { cleaned: c, firstLine: c.split('\n')[0] || 'Thinking…' };
  }, [text]);
  return (
    <DisclosureSection
      open={expanded}
      onOpenChange={setExpanded}
      trigger={<span className="text-xs italic text-muted-foreground/60">{expanded ? 'Thinking' : firstLine}</span>}
      className="my-1 w-full"
      triggerClassName="items-start text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors"
      contentClassName="mt-1"
    >
      <p className="text-left text-xs italic text-muted-foreground/60 whitespace-pre-wrap">{cleaned || 'Thinking…'}</p>
    </DisclosureSection>
  );
});
