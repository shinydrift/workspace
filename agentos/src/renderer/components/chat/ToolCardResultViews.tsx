import React from 'react';
import { renderMarkdown } from '../../lib/markdown';

type DiffRow = { type: 'context' | 'delete' | 'add'; text: string };

export function ToolCardDiffView({ diffRows }: { diffRows: DiffRow[] }) {
  return (
    <div>
      {diffRows.map((row, i) => (
        <div
          key={i}
          className={`flex items-start px-1 py-0.5 leading-relaxed font-mono ${
            row.type === 'add'
              ? 'bg-green-500/10 text-green-700 dark:text-green-300'
              : row.type === 'delete'
                ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                : 'text-muted-foreground/80'
          }`}
        >
          <span className="w-3 shrink-0 text-center select-none">
            {row.type === 'add' ? '+' : row.type === 'delete' ? '-' : ' '}
          </span>
          <code className="whitespace-pre-wrap break-words">{row.text || ' '}</code>
        </div>
      ))}
    </div>
  );
}

export function ToolCardBashView({ ansiResultHtml }: { ansiResultHtml: string }) {
  return (
    <pre className="whitespace-pre-wrap overflow-x-auto leading-relaxed font-mono">
      <code dangerouslySetInnerHTML={{ __html: ansiResultHtml }} />
    </pre>
  );
}

export function ToolCardTaskView({ result }: { result: string }) {
  return (
    <div
      className="chat-markdown prose prose-sm dark:prose-invert max-w-none text-xs opacity-70 prose-headings:text-sm prose-headings:font-medium prose-p:leading-snug prose-li:leading-snug"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
    />
  );
}
