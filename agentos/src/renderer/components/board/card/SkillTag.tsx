import React from 'react';

interface SkillTagProps {
  tag: string;
}

export function SkillTag({ tag }: SkillTagProps) {
  return <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{tag}</span>;
}
