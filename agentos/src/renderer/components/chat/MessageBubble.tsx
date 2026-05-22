import React, { memo, useMemo } from 'react';
import type { Message } from '../../../shared/types';
import { parseAutopilotDecision } from '../../../shared/types';
import { extractStreamText } from '../../lib/streamParsers';
import { renderMarkdown } from '../../lib/markdown';
import { Robot } from '@phosphor-icons/react';
import { type Section, buildSections, handleCodeCopy, hydrateMissingToolResults } from './messageUtils';
import { ToolGroupSection } from './ToolGroupSection';
import { ThinkingSection } from './ThinkingSection';

export { buildSections } from './messageUtils';
export { ToolGroupSection } from './ToolGroupSection';
export { ThinkingSection } from './ThinkingSection';

const TextBubble = memo(function TextBubble({ text, isUser }: { text: string; isUser: boolean }) {
  const html = useMemo(() => {
    const cleaned = extractStreamText(text) ?? text;
    return renderMarkdown(cleaned);
  }, [text]);
  if (isUser) {
    return (
      <div className="flex w-full max-w-3xl flex-col items-start gap-0.5">
        <div className="rounded-2xl bg-muted px-4 py-2.5 text-base">
          <div
            className="chat-markdown prose prose-sm dark:prose-invert max-w-none [&_p]:m-0"
            onClick={handleCodeCopy}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="w-full max-w-3xl text-base">
      <div
        className="chat-markdown prose prose-sm dark:prose-invert max-w-none"
        onClick={handleCodeCopy}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

const AutopilotDecisionBubble = memo(function AutopilotDecisionBubble({ content }: { content: string }) {
  const { reason } = useMemo(() => parseAutopilotDecision(content), [content]);
  return (
    <div className="flex max-w-[80%] items-center gap-1.5">
      <p className="text-xs italic text-muted-foreground/50">{reason}</p>
      <Robot className="h-3 w-3 shrink-0 text-muted-foreground/50" weight="fill" />
    </div>
  );
});

export function MessageBubble({ message, isLatest }: { message: Message; isLatest: boolean }) {
  const isUser = message.role === 'user';
  const blocks = message.normalized?.blocks;

  const sections = useMemo(
    () =>
      blocks && blocks.length > 0
        ? buildSections(hydrateMissingToolResults(blocks, message.normalized?.raw?.payload))
        : null,
    [blocks, message.normalized]
  );

  if (message.source === 'autopilot-decision') {
    return <AutopilotDecisionBubble content={message.content} />;
  }

  if (!sections) {
    return <TextBubble text={message.content} isUser={isUser} />;
  }

  return (
    <>
      {sections.map((section: Section, index: number) => {
        if (section.kind === 'text') {
          return <TextBubble key={`${message.id}-${index}`} text={section.block.text} isUser={isUser} />;
        }
        if (section.kind === 'thinking') {
          return (
            <ThinkingSection
              key={`${message.id}-${index}`}
              text={section.block.text}
              defaultExpanded={index === sections.length - 1}
            />
          );
        }
        return (
          <ToolGroupSection
            key={`${message.id}-${index}`}
            tools={section.tools}
            title={section.title}
            isLatest={isLatest}
            allowPending={false}
          />
        );
      })}
    </>
  );
}
