import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollFade } from '@/components/ui/scroll-fade';

interface Props {
  children: React.ReactNode;
  header?: React.ReactNode;
}

export function InsightsLayout({ children, header }: Props) {
  return (
    <div className="flex flex-col h-full">
      {header && <div className="h-11 px-4 flex items-center shrink-0">{header}</div>}
      <div className="relative flex-1 min-h-0">
        <ScrollFade />
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-4 px-4 py-4 overflow-x-clip max-w-[1200px] mx-auto w-full">{children}</div>
        </ScrollArea>
      </div>
    </div>
  );
}
