import React, { useMemo, useState } from 'react';
import stripAnsi from 'strip-ansi';
import { CaretDown, CaretUp, CheckCircle, XCircle } from '@phosphor-icons/react';
import type { ToolCallInvocation } from '../../../shared/types';
import { unwrapMcpResponse } from '../chat/toolCardUtils';

export function InvocationRow({ invocation }: { invocation: ToolCallInvocation }) {
  const [expanded, setExpanded] = useState(false);

  const displayResponse = useMemo(
    () => (invocation.response ? unwrapMcpResponse(invocation.response) : invocation.response),
    [invocation.response]
  );

  const firstLine = useMemo(() => {
    if (!displayResponse) return '';
    const lines = stripAnsi(displayResponse).trim().split('\n').filter((l) => l.trim());
    const first = lines[0] ?? '';
    return first.length > 120 ? first.slice(0, 120) + '\u2026' : first;
  }, [displayResponse]);

  return (
    <div className="min-w-0 flex flex-col">
      <button
        className="w-full flex items-start gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        {invocation.isError ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" weight="fill" />
        ) : (
          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" weight="fill" />
        )}
        <span className="text-muted-foreground flex-1 min-w-0 truncate font-mono text-xs leading-relaxed">
          {firstLine || '(empty)'}
        </span>
        {expanded ? (
          <CaretUp className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        ) : (
          <CaretDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {invocation.input !== null &&
            typeof invocation.input === 'object' &&
            Object.keys(invocation.input).length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground/70 mb-1">Input</p>
                <pre className="text-xs text-foreground/80 bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
                  {JSON.stringify(invocation.input, null, 2)}
                </pre>
              </div>
            )}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground/70 mb-1">Response</p>
            <pre
              className={`text-xs bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed ${invocation.isError ? 'text-destructive/80' : 'text-foreground/80'}`}
            >
              {displayResponse || '(empty)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
