import React from 'react';

interface ProgressDisplayProps {
  progress: number; // 0–100
}

export function ProgressDisplay({ progress }: ProgressDisplayProps) {
  if (progress < 30) {
    return <span className="text-xs text-muted-foreground">{progress}%</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{progress}%</span>
    </div>
  );
}
