import React, { memo, useMemo } from 'react';
import type { MessageContentBlock } from '../../../shared/types';
import { renderMarkdown } from '../../lib/markdown';
import { ThinkingSection } from './ThinkingSection';
import { ToolGroupSection } from './ToolGroupSection';
import { buildSections, handleCodeCopy } from './messageUtils';

const CURSOR_HTML =
  '<span class="relative inline-flex h-2.5 w-2.5 ml-1 align-middle">' +
  '<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground/40"></span>' +
  '<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-foreground/70"></span>' +
  '</span>';

function injectCursor(html: string): string {
  const idx = html.lastIndexOf('</p>');
  if (idx !== -1) return html.slice(0, idx) + CURSOR_HTML + html.slice(idx);
  return html + CURSOR_HTML;
}

const StreamingTextSection = memo(function StreamingTextSection({ text, isLast }: { text: string; isLast: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div className="w-full text-base">
      <div
        className="chat-markdown prose prose-sm dark:prose-invert max-w-none"
        onClick={handleCodeCopy}
        dangerouslySetInnerHTML={{ __html: isLast ? injectCursor(html) : html }}
      />
    </div>
  );
});

interface Props {
  streamingBlocks: MessageContentBlock[];
}

export function StreamingMessageView({ streamingBlocks }: Props) {
  const sections = useMemo(() => buildSections(streamingBlocks), [streamingBlocks]);

  if (streamingBlocks.length === 0) return null;

  const lastBlock = streamingBlocks[streamingBlocks.length - 1];

  return (
    <div className="flex flex-col gap-2 items-start w-full">
      {sections.map((section, i) => {
        if (section.kind === 'tool_group') {
          return <ToolGroupSection key={i} tools={section.tools} title={section.title} isLatest={true} />;
        }
        if (section.kind === 'thinking') {
          return <ThinkingSection key={i} text={section.block.text} defaultExpanded={i === sections.length - 1} />;
        }
        return <StreamingTextSection key={i} text={section.block.text} isLast={lastBlock === section.block} />;
      })}
    </div>
  );
}
