import React from 'react';
import { Minus, Square, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const isMac = window.electronAPI?.platform === 'darwin';
const TITLE_BAR_H = 'h-[38px]';

interface TitleBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Draggable center area content */
  children?: React.ReactNode;
  className?: string;
}

export function TitleBar({ left, right, children, className }: TitleBarProps) {
  const handleMinimize = () => window.electronAPI?.win.minimize();
  const handleMaximize = () => window.electronAPI?.win.maximize();
  const handleClose = () => window.electronAPI?.win.close();

  return (
    <div className={cn('drag-region shrink-0 flex items-center bg-background', TITLE_BAR_H, className)}>
      {/* Space reserved for macOS traffic lights */}
      {isMac && <div className="w-[76px] shrink-0" />}

      {/* Left slot (e.g. sidebar toggle) */}
      {left && <div className="no-drag-region shrink-0 flex items-center px-1">{left}</div>}

      {/* Center — draggable stretch area */}
      <div className="flex-1 min-w-0 flex items-center justify-center px-2 select-none">{children}</div>

      {/* Right slot (e.g. settings popover) */}
      {right && <div className="no-drag-region shrink-0 flex items-center px-1">{right}</div>}

      {/* Windows / Linux window controls */}
      {!isMac && (
        <div className="no-drag-region flex items-center shrink-0">
          <button
            type="button"
            onClick={handleMinimize}
            className={cn(
              TITLE_BAR_H,
              'w-10 grid place-content-center text-muted-foreground hover:bg-accent/70 transition-colors'
            )}
            aria-label="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className={cn(
              TITLE_BAR_H,
              'w-10 grid place-content-center text-muted-foreground hover:bg-accent/70 transition-colors'
            )}
            aria-label="Maximize"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              TITLE_BAR_H,
              'w-10 grid place-content-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors'
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
