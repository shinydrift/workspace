import React from 'react';
import { CaretRight, CircleNotch, Pause, Play, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  name: string;
  enabled: boolean;
  saveBusy: boolean;
  saveError: string | null;
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
        <span className="text-muted-foreground/60 shrink-0">Edit</span>
        <CaretRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Automation name"
          className="border-none bg-transparent shadow-none focus-visible:ring-0 px-0 text-sm font-medium min-w-0 w-full max-w-[240px] h-auto py-0"
        />
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {saveBusy && <CircleNotch className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
        {saveError && <span className="text-xs text-destructive mr-1">{saveError}</span>}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleEnabled}
          title={enabled ? 'Disable' : 'Enable'}
          aria-label={enabled ? 'Disable' : 'Enable'}
          className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
        >
          {enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRunNow}
            title="Run now"
            aria-label="Run now"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Play className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
