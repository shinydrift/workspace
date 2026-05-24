import React from 'react';
import { CaretRight, CircleNotch, Clock, Play, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/ui/status-badge';

interface Props {
  name: string;
  enabled: boolean;
  saveBusy: boolean;
  saveError: string | null;
  nextRunLabel?: string | null;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onToggleEnabled: () => void;
  onRunNow?: () => void;
  onDelete?: () => void;
}

export function FlowBuilderHeader({
  name,
  enabled,
  saveBusy,
  saveError,
  nextRunLabel,
  onBack,
  onNameChange,
  onToggleEnabled,
  onRunNow,
  onDelete,
}: Props) {
  return (
    <header className="h-11 border-b border-border flex items-center justify-between px-4 shrink-0 bg-background">
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="h-auto p-0 hover:bg-transparent text-muted-foreground hover:text-foreground shrink-0"
        >
          Automations
        </Button>
        <CaretRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Automation name"
          className="border-none bg-transparent shadow-none focus-visible:ring-0 px-0 text-sm font-medium min-w-0 w-full max-w-[240px] h-auto py-0"
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {saveBusy && <CircleNotch className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
        {saveError && <span className="text-xs text-destructive mr-1">{saveError}</span>}
        {nextRunLabel && (
          <span className="hidden md:inline text-xs text-muted-foreground truncate max-w-[200px]">
            Next run: {nextRunLabel}
          </span>
        )}
        <StatusBadge status={enabled ? 'success' : 'idle'} className="gap-1">
          <Clock className="h-3 w-3" />
          {enabled ? 'Active' : 'Disabled'}
        </StatusBadge>
        <Switch
          checked={enabled}
          onCheckedChange={() => onToggleEnabled()}
          aria-label={enabled ? 'Disable automation' : 'Enable automation'}
        />
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            title="Delete automation"
            aria-label="Delete automation"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash className="h-4 w-4" />
          </Button>
        )}
        {onRunNow && (
          <Button type="button" size="sm" onClick={onRunNow} className="h-8 gap-1.5" title="Run now">
            <Play className="h-4 w-4" weight="fill" />
            Run now
          </Button>
        )}
      </div>
    </header>
  );
}
