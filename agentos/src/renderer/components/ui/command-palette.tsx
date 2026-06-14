import React, { useEffect, useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface CommandPaletteProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: T[];
  onSelect: (item: T) => void;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  filterItem: (item: T, query: string) => boolean;
  placeholder?: string;
  footer?: React.ReactNode;
}

export function CommandPalette<T>({
  open,
  onOpenChange,
  items,
  onSelect,
  getKey,
  renderItem,
  filterItem,
  placeholder = 'Search…',
  footer,
}: CommandPaletteProps<T>) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = useMemo(
    () => (query ? items.filter((item) => filterItem(item, query)) : items),
    [query, items, filterItem]
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10 supports-[backdrop-filter]:backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[30%] z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border/60 bg-background shadow-xl overflow-hidden duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>

          <Command shouldFilter={false} className="rounded-none bg-transparent">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
              className="h-auto py-3 text-sm"
            />
            <CommandList className="max-h-72">
              <CommandEmpty>No results</CommandEmpty>
              {filtered.map((item) => (
                <CommandItem
                  key={getKey(item)}
                  value={getKey(item)}
                  onSelect={() => {
                    onSelect(item);
                    onOpenChange(false);
                  }}
                  className="cursor-pointer border-b border-border/30 last:border-b-0 rounded-none px-0 py-0 data-[selected=true]:bg-accent/70 aria-selected:bg-accent/70"
                >
                  {renderItem(item)}
                </CommandItem>
              ))}
            </CommandList>
          </Command>

          {footer && <div className="border-t border-border/40">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
