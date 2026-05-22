import type { AutomationSchedule } from '../../shared/types';

export function toCronExpression(schedule: AutomationSchedule): string | null {
  if (schedule.kind === 'cron') return schedule.expr;

  if (schedule.kind === 'every') {
    const ms = Math.floor(schedule.ms);
    if (!Number.isFinite(ms) || ms < 1_000) return null;
    const seconds = Math.floor(ms / 1_000);
    if (seconds <= 59) return `*/${seconds} * * * * *`;
    if (seconds % 60 === 0) {
      const minutes = seconds / 60;
      if (minutes <= 59) return `*/${minutes} * * * *`;
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        if (hours <= 23) return `0 */${hours} * * *`;
      }
    }
    return null;
  }

  if (schedule.kind === 'at') {
    const d = new Date(schedule.iso);
    if (!Number.isFinite(d.getTime())) return null;
    return `${d.getSeconds()} ${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
  }

  return null;
}

export function describeSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === 'cron') return `Cron: ${schedule.expr}`;
  if (schedule.kind === 'every') {
    const totalMinutes = Math.floor(schedule.ms / 60_000);
    if (totalMinutes < 60) return `Every ${Math.max(totalMinutes, 1)} minute(s)`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `Every ${hours} hour(s)`;
    const days = Math.floor(hours / 24);
    return `Every ${days} day(s)`;
  }
  if (schedule.kind === 'at') return `Once at ${new Date(schedule.iso).toLocaleString()}`;
  return 'Unknown';
}
