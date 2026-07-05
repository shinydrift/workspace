import { toString as describeCron } from 'cronstrue';
import type { AutomationJob, AutomationSchedule, AutomationTrigger } from '../../../shared/types';
import type { ClaudeEffort, CodexReasoning, Provider } from '../../../shared/types/provider';
import { formatTimestamp } from '../../lib/analyticsFormatters';

export type FormState = {
  id?: string;
  name: string;
  description: string;
  projectId: string;
  instructions: string;
  // Pinned agent settings. When `provider` is undefined the run inherits the project/app default.
  provider?: Provider;
  model?: string;
  effort?: ClaudeEffort;
  reasoning?: CodexReasoning;
  triggerKind: 'schedule' | 'manual';
  scheduleKind: 'cron' | 'every' | 'at';
  cronExpr: string;
  everyValue: number;
  everyUnit: 'minutes' | 'hours' | 'days';
  atIsoLocal: string;
  notificationChannel: 'none' | 'slack';
  notifyOnFailure: boolean;
  notificationSlackChannelId: string;
  enabled: boolean;
  deleteAfterRun: boolean;
};

export const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  projectId: '',
  instructions: '',
  triggerKind: 'schedule',
  scheduleKind: 'every',
  cronExpr: '0 9 * * 1-5',
  everyValue: 1,
  everyUnit: 'hours',
  atIsoLocal: '',
  notificationChannel: 'none',
  notifyOnFailure: true,
  notificationSlackChannelId: '',
  enabled: true,
  deleteAfterRun: false,
};

export function fromJob(job: AutomationJob): FormState {
  const base: Partial<FormState> = {
    id: job.id,
    name: job.name,
    description: job.description ?? '',
    projectId: job.projectId,
    instructions: job.instructions,
    provider: job.provider,
    model: job.model,
    effort: job.effort,
    reasoning: job.reasoning,
    notificationChannel: job.notification?.channel ?? 'none',
    notifyOnFailure: job.notification?.onFailure ?? true,
    notificationSlackChannelId: job.notification?.slackChannelId ?? '',
    enabled: job.enabled,
    deleteAfterRun: job.deleteAfterRun,
    triggerKind: job.trigger.kind === 'schedule' ? 'schedule' : 'manual',
  };

  if (job.trigger.kind === 'schedule') {
    const { schedule } = job.trigger;
    if (schedule.kind === 'cron') {
      return { ...EMPTY_FORM, ...base, scheduleKind: 'cron', cronExpr: schedule.expr };
    }
    if (schedule.kind === 'at') {
      const d = new Date(schedule.iso);
      const local = Number.isFinite(d.getTime())
        ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
        : '';
      return { ...EMPTY_FORM, ...base, scheduleKind: 'at', atIsoLocal: local };
    }
    const minutes = Math.max(1, Math.floor(schedule.ms / 60_000));
    if (minutes % (60 * 24) === 0) {
      return { ...EMPTY_FORM, ...base, scheduleKind: 'every', everyValue: minutes / (60 * 24), everyUnit: 'days' };
    }
    if (minutes % 60 === 0) {
      return { ...EMPTY_FORM, ...base, scheduleKind: 'every', everyValue: minutes / 60, everyUnit: 'hours' };
    }
    return { ...EMPTY_FORM, ...base, scheduleKind: 'every', everyValue: minutes, everyUnit: 'minutes' };
  }

  return { ...EMPTY_FORM, ...base };
}

export function toTrigger(form: FormState): AutomationTrigger {
  if (form.triggerKind === 'manual') return { kind: 'manual' };
  return { kind: 'schedule', schedule: toSchedule(form) };
}

function everyUnitToMs(unit: FormState['everyUnit']): number {
  return unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000;
}

export function toSchedule(form: FormState): AutomationSchedule {
  if (form.scheduleKind === 'cron') {
    return { kind: 'cron', expr: form.cronExpr.trim() };
  }
  if (form.scheduleKind === 'at') {
    const dt = form.atIsoLocal ? new Date(form.atIsoLocal) : new Date();
    return { kind: 'at', iso: dt.toISOString() };
  }
  return { kind: 'every', ms: Math.max(1, Math.floor(form.everyValue)) * everyUnitToMs(form.everyUnit) };
}

export function describeTrigger(trigger: AutomationTrigger): string {
  if (trigger.kind === 'manual') return 'Manual';
  if (trigger.kind === 'webhook') return 'Webhook';
  return describeSchedule(trigger.schedule);
}

export function describeSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === 'cron') return `Cron: ${schedule.expr}`;
  if (schedule.kind === 'every') {
    const totalMinutes = Math.floor(schedule.ms / 60_000);
    if (totalMinutes < 60) return `Every ${Math.max(totalMinutes, 1)} minute(s)`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `Every ${hours} hour(s)`;
    return `Every ${Math.floor(hours / 24)} day(s)`;
  }
  return `Once at ${new Date(schedule.iso).toLocaleString()}`;
}

export function computeNextRun(editing: FormState, job?: AutomationJob): string {
  if (editing.triggerKind === 'manual') return '—';
  if (editing.scheduleKind === 'at') {
    if (!editing.atIsoLocal) return '—';
    const d = new Date(editing.atIsoLocal);
    if (d.getTime() <= Date.now()) return 'In the past';
    return formatTimestamp(d.getTime());
  }
  if (editing.scheduleKind === 'every') {
    if (!job?.lastRunAt) return 'Not yet run';
    const intervalMs = Math.max(1, editing.everyValue) * everyUnitToMs(editing.everyUnit);
    const nextTs = job.lastRunAt + intervalMs;
    if (nextTs <= Date.now()) return 'Pending';
    return formatTimestamp(nextTs);
  }
  return triggerLabel(editing);
}

export function humanizeCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  try {
    return describeCron(trimmed, { verbose: false, throwExceptionOnParseError: true });
  } catch {
    return null;
  }
}

export function triggerLabel(editing: FormState): string {
  if (editing.triggerKind === 'manual') return 'Manual';
  if (editing.scheduleKind === 'cron') return `Cron: ${editing.cronExpr}`;
  if (editing.scheduleKind === 'at')
    return editing.atIsoLocal
      ? `Once at ${new Date(editing.atIsoLocal).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : 'Once (not set)';
  return `Every ${editing.everyValue} ${editing.everyUnit}`;
}
