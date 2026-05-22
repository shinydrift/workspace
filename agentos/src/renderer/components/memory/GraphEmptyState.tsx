import React from 'react';
import { Button } from '../ui/button';

interface Props {
  loading: boolean;
  entityCount: number | null;
  onRebuild: () => void;
}

export function GraphEmptyState({ loading, entityCount, onRebuild }: Props) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (entityCount === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">No entities indexed yet.</p>
        <p className="text-xs text-muted-foreground">Build the memory index to explore connections.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRebuild}>
          Rebuild graph
        </Button>
      </>
    );
  }
  return <p className="text-sm text-muted-foreground">Search for an entity to explore its connections.</p>;
}
