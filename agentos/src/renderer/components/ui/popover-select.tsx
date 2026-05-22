import React, { useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface PopoverSelectOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Optional leading element rendered inside the trigger and each option row (e.g. a priority dot). */
  leading?: React.ReactNode;
}

interface PopoverSelectProps<T extends string = string> {
  value: T;
  options: ReadonlyArray<PopoverSelectOption<T>>;
  onChange: (value: T) => void;
  /** Custom trigger element. When omitted a compact text+caret button is rendered. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
}

export function PopoverSelect<T extends string = string>({
  value,
  options,
  onChange,
  trigger,
  triggerClassName,
  contentClassName,
  align = 'start',
}: PopoverSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-foreground hover:bg-muted/60',
              triggerClassName
            )}
          >
            {current?.leading}
            <span>{current?.label ?? value}</span>
            <CaretDown size={9} className="text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('p-1', contentClassName)}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (opt.value !== value) onChange(opt.value);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted',
              opt.value === value ? 'bg-muted/60 font-medium' : 'text-muted-foreground'
            )}
          >
            {opt.leading}
            {opt.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
