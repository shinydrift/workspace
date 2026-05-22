import React from 'react';

export function InheritHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="text-xs text-muted-foreground">Using app setting.</p>;
}
