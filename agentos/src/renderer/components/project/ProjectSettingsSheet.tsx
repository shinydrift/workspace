import React from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Gear, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';
import type { Props as PanelProps } from './ProjectSettingsPanel';

interface Props extends PanelProps {
  open: boolean;
  onClose: () => void;
}

export function ProjectSettingsSheet({ open, onClose, ...panelProps }: Props) {
  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent hideClose className="w-[820px] max-w-[95vw] gap-0 p-0">
        <div className="flex items-center justify-between py-3.5 px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Gear size={16} className="text-muted-foreground" />
            <SheetTitle>Project Settings — {panelProps.projectName}</SheetTitle>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="Close project settings"
          >
            <X size={16} />
          </Button>
        </div>

        <ProjectSettingsPanel {...panelProps} />
      </SheetContent>
    </Sheet>
  );
}
