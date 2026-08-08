import React from 'react';
import { Shield, ShieldWarning } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  /** Explicit per-thread pick. `undefined` = no pick yet, so the inherited setting applies. */
  runOnHost: boolean | undefined;
  /** Effective project → app setting. `undefined` while it is still loading. */
  inheritedRunOnHost: boolean | undefined;
  onToggle: (runOnHost: boolean) => void;
  /** Appended to the tooltip — used to say the change lands at the next start. */
  note?: string;
  className?: string;
}

/**
 * Chat-level sandbox override, shared by the new-thread composer and a running thread's prompt bar.
 * Clicking always pins an explicit boolean on the thread: the point of this control is to differ
 * from the project/app setting, and a pick that silently reverted to inheriting would move again
 * the next time someone changed those levels. Until the first pick the button renders the inherited
 * state, muted, so it reads as "this is what you'd get" rather than "this was chosen".
 */
export function SandboxToggleButton({ runOnHost, inheritedRunOnHost, onToggle, note, className }: Props) {
  if (inheritedRunOnHost === undefined) return null; // effective setting not loaded yet

  const effective = runOnHost ?? inheritedRunOnHost;
  const pinned = runOnHost !== undefined;
  const label = effective ? 'Sandbox off — running on host' : 'Sandbox on';
  const action = effective ? 'Click to sandbox' : 'Click to run on host';

  return (
    <Button
      onClick={() => onToggle(!effective)}
      variant="ghost"
      size="icon"
      title={[`${label}${pinned ? '' : ' (inherited)'} — ${action}`, note].filter(Boolean).join('. ')}
      aria-label={label}
      className={cn(
        'h-7 w-7 shrink-0',
        !pinned
          ? 'text-muted-foreground hover:text-foreground'
          : effective
            ? 'text-amber-500 hover:text-amber-400'
            : 'text-emerald-500 hover:text-emerald-400',
        className
      )}
    >
      {effective ? (
        <ShieldWarning className="h-4 w-4" />
      ) : (
        <Shield className="h-4 w-4" weight={pinned ? 'fill' : 'regular'} />
      )}
    </Button>
  );
}
