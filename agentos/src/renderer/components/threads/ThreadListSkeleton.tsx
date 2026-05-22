import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

const SKELETON_GROUPS = [0, 1];
const SKELETON_ITEMS = [0, 1, 2];

export function ThreadListSkeleton() {
  return (
    <ScrollArea className="flex-1 px-2 pb-1.5">
      <div className="mt-0.5 space-y-2">
        {SKELETON_GROUPS.map((g) => (
          <div key={g}>
            <div className="w-full px-1 py-0.5 flex items-center gap-1.5">
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
            </div>
            <div className="mt-0.5 space-y-px">
              {SKELETON_ITEMS.map((i) => (
                <div key={i} className="px-2.5 py-2 flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-full" />
                  <Skeleton className="h-3 flex-1 rounded" />
                  <Skeleton className="h-3 w-6 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
