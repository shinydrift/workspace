import React from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

interface Props {
  title: string;
  count?: React.ReactNode;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}

export function InsightSection({ title, count, children, headerAction }: Props) {
  return (
    <Collapsible className="flex flex-col gap-1 border-t border-border/60 pt-3">
      <div className="flex items-center gap-1">
        <CollapsibleTrigger className="group flex flex-1 items-center gap-1.5 text-left transition-colors">
          <CaretRight
            className="shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
            size={11}
            weight="bold"
          />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {title}
            {count !== undefined && <span className="normal-case font-normal"> ({count})</span>}
          </p>
        </CollapsibleTrigger>
        {headerAction}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
