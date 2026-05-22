import React from 'react';
import { ArrowLineLeft, ArrowLineRight, Clock } from '@phosphor-icons/react';
import { cn, focusRing } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Props {
  sidebarHidden: boolean;
  onToggle: () => void;
  onOpenAutomations: () => void;
}

export function SidebarToggle({ sidebarHidden, onToggle, onOpenAutomations }: Props) {
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('h-8 w-8 hover:bg-black/10 dark:hover:bg-white/10', focusRing)}
        onClick={onToggle}
        title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
        aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
      >
        {sidebarHidden ? <ArrowLineRight className="h-5 w-5" /> : <ArrowLineLeft className="h-5 w-5" />}
      </Button>
      {sidebarHidden && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 hover:bg-black/10 dark:hover:bg-white/10', focusRing)}
          onClick={onOpenAutomations}
          title="Automations"
          aria-label="Automations"
        >
          <Clock className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
