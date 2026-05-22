import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FormState } from './scheduleUtils';

export function ScheduleFields({
  editing,
  patch,
}: {
  editing: FormState;
  patch: <K extends keyof FormState>(key: K, val: FormState[K]) => void;
}) {
  return (
    <div className="space-y-2 pt-1">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={editing.triggerKind} onValueChange={(v) => patch('triggerKind', v as FormState['triggerKind'])}>
          <SelectTrigger className="h-7 px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual only</SelectItem>
            <SelectItem value="schedule">Schedule</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {editing.triggerKind === 'schedule' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Schedule</Label>
          <Select
            value={editing.scheduleKind}
            onValueChange={(v) => patch('scheduleKind', v as FormState['scheduleKind'])}
          >
            <SelectTrigger className="h-7 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="every">Every</SelectItem>
              <SelectItem value="cron">Cron expression</SelectItem>
              <SelectItem value="at">One time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {editing.triggerKind === 'schedule' && editing.scheduleKind === 'every' && (
        <div className="flex gap-1.5">
          <Input
            type="number"
            min={1}
            value={editing.everyValue}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              patch('everyValue', Number.isFinite(v) ? v : 1);
            }}
            className="h-7 w-16 text-xs px-2"
          />
          <Select value={editing.everyUnit} onValueChange={(v) => patch('everyUnit', v as FormState['everyUnit'])}>
            <SelectTrigger className="flex-1 h-7 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {editing.triggerKind === 'schedule' && editing.scheduleKind === 'cron' && (
        <div className="space-y-1">
          <Input
            value={editing.cronExpr}
            onChange={(e) => patch('cronExpr', e.target.value)}
            placeholder="0 9 * * 1-5"
            className="h-7 text-xs font-mono px-2"
          />
          <p className="text-xs text-muted-foreground">minute hour day month weekday</p>
        </div>
      )}

      {editing.triggerKind === 'schedule' && editing.scheduleKind === 'at' && (
        <Input
          type="datetime-local"
          value={editing.atIsoLocal}
          onChange={(e) => patch('atIsoLocal', e.target.value)}
          className="h-7 text-xs px-2"
        />
      )}
    </div>
  );
}
