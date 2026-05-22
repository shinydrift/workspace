import React, { memo } from 'react';
import { Button } from '@/components/ui/button';
import { ListItem } from '@/components/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SavedProject, SlackChannelOption } from '../../../shared/types';

interface Props {
  channelId: string;
  channel: SlackChannelOption | undefined;
  mappingLabel: string;
  projects: SavedProject[];
  onSetMapping: (value: string) => void;
  onBrowse: () => void;
  onRemove: () => void;
}

export const ChannelListItem = memo(function ChannelListItem({
  channelId,
  channel,
  mappingLabel,
  projects,
  onSetMapping,
  onBrowse,
  onRemove,
}: Props) {
  return (
    <ListItem className="gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{channel?.name ?? '(unknown)'}</div>
        <div className="font-mono text-muted-foreground truncate">{channelId}</div>
      </div>
      <span className="text-muted-foreground shrink-0">
        {channel ? (channel.isPrivate ? 'Private' : 'Public') : '—'}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="h-auto gap-1 px-2 py-1 text-xs truncate max-w-[140px]">
            {mappingLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onSetMapping('')}>No project</DropdownMenuItem>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onSetMapping(`project:${p.id}`)}>
              {p.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onBrowse} className="text-muted-foreground">
            Browse directory…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={onRemove}>
        Remove
      </Button>
    </ListItem>
  );
});
