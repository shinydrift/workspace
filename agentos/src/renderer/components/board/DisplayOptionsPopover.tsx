import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { CaretDown } from '@phosphor-icons/react';
import { useCardPrefs, type CardDisplayPrefs } from './CardPrefsContext';

interface PrefRow {
  key: keyof CardDisplayPrefs;
  label: string;
}

const CARD_ROWS: PrefRow[] = [
  { key: 'showAgentBadge', label: 'Agent badge' },
  { key: 'showProgress', label: 'Progress' },
  { key: 'showSkillTags', label: 'Skill tags' },
  { key: 'showBlockerCount', label: 'Blocker count' },
  { key: 'showDueDateBadge', label: 'Due date badge' },
  { key: 'showSubtaskBadge', label: 'Subtask progress' },
  { key: 'showAgingIndicator', label: 'Aging indicator' },
  { key: 'showTaskId', label: 'Task ID' },
  { key: 'showDescriptionPreview', label: 'Description preview' },
];

const COLUMN_ROWS: PrefRow[] = [
  { key: 'showWipLimit', label: 'WIP limit' },
  { key: 'showTaskCount', label: 'Task count' },
];

export function DisplayOptionsPopover() {
  const { prefs, setPref } = useCardPrefs();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs">
          Display
          <CaretDown size={11} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Card Fields</p>
        <div className="flex flex-col gap-1.5">
          {CARD_ROWS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={prefs[key]}
                onCheckedChange={(checked) => setPref(key, checked === true)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs">{label}</span>
            </label>
          ))}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mt-3 mb-2">
          Column Fields
        </p>
        <div className="flex flex-col gap-1.5">
          {COLUMN_ROWS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={prefs[key]}
                onCheckedChange={(checked) => setPref(key, checked === true)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs">{label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
