import React from 'react';
import { AppWindow, ArrowClockwise } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  checking: boolean;
  actionBusy: boolean;
  error: string;
  onOpenDocker: () => void;
  onRecheck: () => void;
}

export function DockerDesktopPrompt({ open, checking, actionBusy, error, onOpenDocker, onRecheck }: Props) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md [&>button]:hidden">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-white dark:bg-white dark:text-black">
            <AppWindow className="h-5 w-5" />
          </div>
          <DialogTitle>Docker Desktop Required</DialogTitle>
          <DialogDescription>
            AgentOS needs Docker Desktop on macOS before sandboxed threads can start. Open it if it is installed, or install
            it and come back here to recheck.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
          <div>
            1. Click <span className="font-medium text-foreground">Open Docker Desktop</span>.
          </div>
          <div>2. If Docker is not installed, AgentOS will send you to the Docker Desktop download page.</div>
          <div>
            3. After Docker finishes starting, click <span className="font-medium text-foreground">Recheck</span>.
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={onRecheck} disabled={checking || actionBusy}>
            <ArrowClockwise className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Recheck'}
          </Button>
          <Button type="button" onClick={onOpenDocker} disabled={checking || actionBusy}>
            {actionBusy ? 'Opening…' : 'Open Docker Desktop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
