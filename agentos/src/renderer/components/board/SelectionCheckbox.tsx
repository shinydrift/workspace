import React from 'react';
import { cn } from '@/lib/utils';

interface SelectionCheckboxProps {
  selected: boolean;
  onToggle: () => void;
  onSetLastClicked?: () => void;
  /** When true, renders inline (shrink-0) for list rows. Default is absolute card overlay. */
  inline?: boolean;
}

export function SelectionCheckbox({ selected, onToggle, onSetLastClicked, inline }: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      className={cn(
        'w-4 h-4 rounded flex items-center justify-center transition-opacity',
        'border border-border/60 bg-background/80',
        selected ? 'opacity-100 bg-primary border-primary' : 'opacity-0 group-hover:opacity-100',
        inline ? 'shrink-0' : 'absolute top-1.5 left-1.5 z-10'
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSetLastClicked?.();
        onToggle();
      }}
      aria-label={selected ? 'Deselect task' : 'Select task'}
    >
      {selected && <span className="text-primary-foreground text-[9px] font-bold leading-none">✓</span>}
    </button>
  );
}
