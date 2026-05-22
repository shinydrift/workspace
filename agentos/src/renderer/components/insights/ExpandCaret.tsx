import React from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';

export function ExpandCaret({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <CaretDown className="h-3 w-3 text-muted-foreground shrink-0" />
  ) : (
    <CaretRight className="h-3 w-3 text-muted-foreground shrink-0" />
  );
}
