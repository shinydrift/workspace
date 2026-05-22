import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: false, label: 'Private', description: 'Only accessible within your Tailnet' },
  { value: true, label: 'Public', description: 'Exposed publicly via Tailscale Funnel on port 3000' },
] as const;

interface Props {
  value: boolean;
  isInherited: boolean;
  onChange: (value: boolean) => void;
}

export function TailscaleFunnelAccess({ value, isInherited, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Access</Label>
      <div className="flex gap-3">
        {OPTIONS.map((opt) => (
          <Button
            key={String(opt.value)}
            type="button"
            variant="outline"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 h-auto flex-col items-start px-3 py-2 text-xs',
              value === opt.value
                ? 'border-primary bg-primary/5 text-primary font-medium hover:bg-primary/5 hover:text-primary'
                : 'text-muted-foreground hover:border-foreground hover:bg-transparent'
            )}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="mt-0.5 text-muted-foreground">{opt.description}</span>
          </Button>
        ))}
      </div>
      {isInherited && <p className="text-xs text-muted-foreground">Using app setting.</p>}
    </div>
  );
}
