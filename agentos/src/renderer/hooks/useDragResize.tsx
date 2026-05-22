import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DotsSixVertical } from '@phosphor-icons/react';

export function useDragResize({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  direction = 'right',
}: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey: string;
  /** 'right' = handle on right edge, drag right to expand (default). 'left' = handle on left edge, drag left to expand. */
  direction?: 'right' | 'left';
}) {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) return Math.min(maxWidth, Math.max(minWidth, parsed));
    }
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);

  // Refs to avoid stale closures and allow stable handleMouseDown
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const latestWidthRef = useRef(width);
  latestWidthRef.current = width;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = latestWidthRef.current;
    setIsDragging(true);
  }, []); // stable — all mutable values go through refs

  // Manage document listeners inside useEffect so they're cleaned up on unmount
  useEffect(() => {
    if (!isDragging) return;

    function onMouseMove(ev: MouseEvent) {
      const delta = direction === 'left' ? startXRef.current - ev.clientX : ev.clientX - startXRef.current;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      latestWidthRef.current = next;
      setWidth(next);
    }

    function onMouseUp() {
      localStorage.setItem(storageKey, String(latestWidthRef.current));
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, minWidth, maxWidth, direction, storageKey]);

  return { width, isDragging, handleMouseDown };
}

/** Drag handle bar — place inside a `position: relative` container at the resizable edge. */
export function DragHandle({
  onMouseDown,
  direction = 'right',
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  direction?: 'right' | 'left';
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`group absolute inset-y-0 ${direction === 'left' ? 'left-0' : 'right-0'} w-2 cursor-col-resize z-10 flex items-center justify-center`}
    >
      <DotsSixVertical size={12} className="text-border/60 group-hover:text-primary/60 transition-colors" />
    </div>
  );
}
