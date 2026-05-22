import * as React from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './collapsible';
import { cn } from '@/lib/utils';

interface DisclosureSectionProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  hideCaret?: boolean;
}

function DisclosureSection({
  trigger,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  triggerClassName,
  contentClassName,
  hideCaret = false,
}: DisclosureSectionProps) {
  const controlled = open !== undefined;
  return (
    <Collapsible
      open={controlled ? open : undefined}
      defaultOpen={controlled ? undefined : defaultOpen}
      onOpenChange={onOpenChange}
      className={className}
    >
      <CollapsibleTrigger
        className={cn('group flex w-full items-center gap-1.5 text-left transition-colors', triggerClassName)}
      >
        {!hideCaret && (
          <CaretRight
            className="shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
            size={11}
            weight="bold"
          />
        )}
        {trigger}
      </CollapsibleTrigger>
      <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
    </Collapsible>
  );
}

export { DisclosureSection };
