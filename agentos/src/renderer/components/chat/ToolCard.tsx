import React, { useMemo } from 'react';
import stripAnsi from 'strip-ansi';
import { getArgSummary } from '../../lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { DisclosureSection } from '@/components/ui/disclosure-section';
import { ToolCardDiffView, ToolCardBashView, ToolCardTaskView } from './ToolCardResultViews';
import { buildDiffRows, renderAnsiHtml, parseTaskResult, unwrapMcpResponse } from './toolCardUtils';

type Props = {
  name: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  pending?: boolean;
};

export function ToolCard({ name, args, result, isError, pending = false }: Props) {
  const lowerName = name.toLowerCase();
  const isEdit = lowerName === 'edit';
  const isBash = lowerName === 'bash';
  const isTask = lowerName === 'task' || lowerName === 'agent';
  const displayName = isTask ? 'Task' : name;

  const argSummary = getArgSummary(name, args);
  const hasFullContent = result != null && result.length > 0;

  const editArgs = isEdit && args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
  const oldString = typeof editArgs?.old_string === 'string' ? editArgs.old_string : '';
  const newString = typeof editArgs?.new_string === 'string' ? editArgs.new_string : '';

  const diffRows = useMemo(
    () => (isEdit && (oldString || newString) ? buildDiffRows(oldString, newString) : []),
    [isEdit, oldString, newString]
  );

  const editStat = useMemo(() => {
    if (!isEdit || result == null) return null;
    const ol = oldString ? oldString.split('\n').length : 0;
    const nl = newString ? newString.split('\n').length : 0;
    return ol > 0 || nl > 0 ? `+${nl} -${ol}` : null;
  }, [isEdit, result, oldString, newString]);

  const ansiResultHtml = useMemo(
    () => (isBash && hasFullContent ? renderAnsiHtml(result ?? '') : ''),
    [isBash, hasFullContent, result]
  );

  // Full untruncated arg for expanded view (Bash gets $ prefix; others get pretty JSON)
  const fullArgDisplay = useMemo(() => {
    if (!args || typeof args !== 'object') return '';
    const a = args as Record<string, unknown>;
    if (isBash && typeof a.command === 'string') return `$ ${a.command}`;
    if (isEdit || isTask) {
      if (typeof a.description === 'string') return a.description;
      if (typeof a.prompt === 'string') return a.prompt;
      return '';
    }
    return JSON.stringify(args, null, 2);
  }, [args, isBash, isEdit, isTask]);

  const prettyResult = useMemo(
    () => (result && !isBash && !isEdit && !isTask ? unwrapMcpResponse(result) : (result ?? '')),
    [result, isBash, isEdit, isTask]
  );

  // First line preview and whether there is more content
  const { firstLine, hasMore } = useMemo(() => {
    if (!hasFullContent) return { firstLine: '', hasMore: false };
    const raw = isTask
      ? parseTaskResult(result ?? '')
          .replace(/^#+\s*/gm, '')
          .replace(/\*\*/g, '')
      : isBash
        ? stripAnsi(result ?? '')
        : prettyResult; // use unwrapped/formatted text so MCP tools don't show the raw envelope
    const lines = raw
      .trim()
      .split('\n')
      .filter((l: string) => l.trim());
    const first = lines[0] ?? '';
    return {
      firstLine: first.length > 120 ? first.slice(0, 120) + '…' : first,
      hasMore: lines.length > 1,
    };
  }, [hasFullContent, isTask, isBash, result, prettyResult]);

  return (
    <div className={`text-xs min-w-0 ${isError ? 'text-destructive' : ''}`}>
      {/* Header: name + arg summary + pending spinner / edit stat */}
      <div className="flex w-full items-center gap-1.5 px-2 py-[3px]">
        <span className="font-medium text-foreground/80 min-w-0 truncate">{displayName}</span>
        {argSummary ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground ml-0.5">{argSummary}</span>
        ) : (
          <span className="flex-1" />
        )}
        {pending && <Spinner size="sm" className="shrink-0" aria-label="Tool running" />}
        {!pending && editStat && (
          <span className="shrink-0 flex items-center gap-1 font-medium">
            {editStat.split(' ').map((part, i) =>
              part.startsWith('+') ? (
                <span key={i} className="text-green-600 dark:text-green-400">
                  {part}
                </span>
              ) : part.startsWith('-') ? (
                <span key={i} className="text-red-500 dark:text-red-400">
                  {part}
                </span>
              ) : (
                <span key={i}>{part}</span>
              )
            )}
          </span>
        )}
      </div>

      {/* Result area */}
      {hasFullContent && (
        <div className={`pl-5 pr-2 pb-1.5 ${isError ? 'text-destructive/70' : 'text-muted-foreground/60'}`}>
          <DisclosureSection
            hideCaret
            triggerClassName="items-baseline flex-wrap leading-snug"
            trigger={
              <>
                {firstLine && <span className="font-mono break-all min-w-0">{firstLine}</span>}
                {(hasMore || (isTask && !hasMore)) && (
                  <span className="shrink-0 text-xs text-muted-foreground/40">
                    <span className="group-data-[state=open]:hidden">show more</span>
                    <span className="hidden group-data-[state=open]:inline">show less</span>
                  </span>
                )}
              </>
            }
            defaultOpen={false}
            contentClassName="space-y-1 mt-0.5"
          >
            {fullArgDisplay && (
              <div className="font-mono text-muted-foreground/50 whitespace-pre-wrap break-words max-w-full pb-0.5 border-b border-border/30">
                {fullArgDisplay}
              </div>
            )}
            {isTask ? (
              <ToolCardTaskView result={parseTaskResult(result ?? '')} />
            ) : isEdit && diffRows.length > 0 ? (
              <ToolCardDiffView diffRows={diffRows} />
            ) : isBash ? (
              <ToolCardBashView ansiResultHtml={ansiResultHtml} />
            ) : (
              <pre className="whitespace-pre-wrap break-words leading-relaxed font-mono max-w-full">{prettyResult}</pre>
            )}
          </DisclosureSection>
        </div>
      )}
    </div>
  );
}
