import React, { useRef } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import { Button } from '@/components/ui/button';
import '@xterm/xterm/css/xterm.css';
import '../../styles/terminal.css';

interface TerminalPaneProps {
  threadId: string;
  fontSize?: number;
}

export function TerminalPane({ threadId, fontSize = 14 }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { clear, scrollToBottom } = useTerminal(containerRef, threadId, { fontSize });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex gap-2 px-2 py-1 bg-muted/40 border-b border-border shrink-0">
        <Button onClick={clear} variant="outline" size="sm">
          Clear
        </Button>
        <Button onClick={scrollToBottom} variant="outline" size="sm">
          Scroll to bottom
        </Button>
      </div>

      {/* xterm.js canvas — keep inline style for FitAddon sizing */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          background: 'var(--background)',
        }}
      />
    </div>
  );
}
