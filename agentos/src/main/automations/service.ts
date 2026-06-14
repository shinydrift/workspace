import { schedule as scheduleCron, validate as validateCron } from 'node-cron';
import { nanoid } from 'nanoid';
import type {
  AutomationCreateRequest,
  AutomationJob,
  AutomationRunRecord,
  AutomationSchedule,
} from '../../shared/types';
import { getAllAutomationJobs, getAutomationJob, saveAutomationJob, deleteAutomationJob } from '../threads/db';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { executeRun } from './runner';
import { webhookServer } from './webhookServer';
import { webhookQueue } from './webhookQueue';
import { tailscaleManager } from './tailscaleManager';
import { getStore } from '../store/index';

const DEFAULT_WEBHOOK_PORT = 3464;

type ScheduledHandle = {
  stop: () => void;
};

class AutomationService {
  private tasks = new Map<string, ScheduledHandle>();
  private homeDir: string | null = null;
  private started = false;

  init(homeDir: string): void {
    this.homeDir = homeDir;
  }

  start(): void {
    if (this.started) return;
    if (!this.homeDir) throw new Error('AutomationService.init(homeDir) must be called before start()');
    this.started = true;
    const settings = getStore().get('settings');
    const port = settings.webhookPort ?? DEFAULT_WEBHOOK_PORT;
    webhookQueue.init(this.homeDir);
    webhookQueue.setProcessor(async (jobId, source, payload) => {
      const job = getAutomationJob(jobId);
      if (!job || !job.enabled) return;
      await this.executeJob(job, 'webhook', payload);
    });

    webhookServer.start(port);

    if (settings.tailscale?.authKey && settings.tailscale?.funnel) {
      tailscaleManager.configure(settings.tailscale?.authKey, port);
      tailscaleManager.start().catch((err: unknown) => {
        eventLogger.warn('tailscale', 'Tailscale startup failed', { error: getErrorMessage(err) });
      });
    }

    for (const job of this.list()) {
      if (job.trigger.kind === 'webhook') {
        webhookServer.registerJob(job.id, job.trigger.webhook.secret, job.trigger.webhook.source);
      }
      if (job.enabled) this.scheduleJob(job);
    }

    webhookQueue.replayPending().catch((err: unknown) => {
      eventLogger.warn('webhook', 'Pending webhook replay failed', { error: getErrorMessage(err) });
    });

    eventLogger.info('automation', 'Automation service started', { count: this.tasks.size });
  }

  stop(): void {
    this.started = false;
    for (const task of this.tasks.values()) task.stop();
    this.tasks.clear();
    webhookServer.stop();
    tailscaleManager.stop().catch(() => {});
  }

  dispose(): void {
    this.stop();
  }

  list(): AutomationJob[] {
    return getAllAutomationJobs();
  }

  create(req: AutomationCreateRequest): AutomationJob {
    this.assertValidTrigger(req.trigger);
    const now = Date.now();
    const job: AutomationJob = {
      id: nanoid(),
      name: req.name.trim(),
      description: req.description?.trim() || undefined,
      projectId: req.projectId,
      trigger: req.trigger,
      instructions: req.instructions,
      kanbanTaskTemplate: req.kanbanTaskTemplate,
      notification: req.notification,
      enabled: req.enabled ?? true,
      deleteAfterRun: req.deleteAfterRun ?? false,
      createdAt: now,
      updatedAt: now,
      runCountOk: 0,
      runCountError: 0,
    };
    this.save(job);
    if (job.trigger.kind === 'webhook') {
      webhookServer.registerJob(job.id, job.trigger.webhook.secret, job.trigger.webhook.source);
    }
    if (job.enabled) this.scheduleJob(job);
    eventLogger.info('automation', 'Automation created', { id: job.id, name: job.name, projectId: job.projectId });
    return job;
  }

  update(id: string, patch: Partial<Omit<AutomationJob, 'id' | 'createdAt'>>): AutomationJob {
    const existing = this.get(id);
    const merged: AutomationJob = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    if (merged.trigger.kind === 'schedule') {
      this.assertValidSchedule(merged.trigger.schedule);
    }
    if (merged.trigger.kind === 'webhook') {
      webhookServer.registerJob(merged.id, merged.trigger.webhook.secret, merged.trigger.webhook.source);
    }
    this.save(merged);
    this.reschedule(merged);
    eventLogger.info('automation', 'Automation updated', { id, enabled: merged.enabled });
    return merged;
  }

  toggle(id: string, enabled: boolean): AutomationJob {
    return this.update(id, { enabled });
  }

  remove(id: string, reason?: string): void {
    this.tasks.get(id)?.stop();
    this.tasks.delete(id);
    webhookServer.unregisterJob(id);
    deleteAutomationJob(id);
    eventLogger.info('automation', 'Automation deleted', { id, ...(reason ? { reason } : {}) });
  }

  removeByProjectId(projectId: string, reason: string): void {
    for (const job of this.list()) {
      if (job.projectId === projectId) this.remove(job.id, reason);
    }
  }

  // Create-only: if the job already exists, preserve the user's edits and just reschedule.
  // Consequence: changes to spec fields (e.g. cron schedule) in new app versions won't
  // auto-propagate to existing users — they must delete and recreate the automation.
  ensureSystemJob(
    spec: Omit<AutomationJob, 'createdAt' | 'updatedAt' | 'runCountOk' | 'runCountError' | 'lastRunAt' | 'runHistory'>
  ): void {
    const existing = getAutomationJob(spec.id);
    if (existing) {
      this.scheduleJob(existing);
      return;
    }
    const now = Date.now();
    const job: AutomationJob = {
      ...spec,
      createdAt: now,
      updatedAt: now,
      lastRunAt: undefined,
      runCountOk: 0,
      runCountError: 0,
      runHistory: undefined,
    };
    this.save(job);
    this.scheduleJob(job);
    eventLogger.info('automation', 'System job created', { id: spec.id });
  }

  // Remove a hidden system job by ID (no-op if not found).
  removeSystemJob(id: string, reason?: string): void {
    if (getAutomationJob(id)) this.remove(id, reason);
  }

  async testWebhookEvent(jobId: string, samplePayload: unknown): Promise<{ ok: boolean; error?: string }> {
    try {
      const job = this.get(jobId);
      if (job.trigger.kind !== 'webhook') throw new Error('Job does not have a webhook trigger');
      await webhookQueue.enqueue(jobId, job.trigger.webhook.source, samplePayload, {
        'x-webhook-test': 'true',
      });
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: getErrorMessage(err) };
    }
  }

  async runNow(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.executeJob(this.get(id), 'manual');
      return { ok: true };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { ok: false, error: message };
    }
  }

  get(id: string): AutomationJob {
    const job = getAutomationJob(id);
    if (!job) throw new Error(`Automation ${id} not found`);
    return job;
  }

  private save(job: AutomationJob): void {
    saveAutomationJob(job);
  }

  private scheduleJob(job: AutomationJob): void {
    this.tasks.get(job.id)?.stop();
    this.tasks.delete(job.id);
    const task = this.buildTask(job);
    if (!task) return;
    this.tasks.set(job.id, task);
  }

  private buildTask(job: AutomationJob): ScheduledHandle | null {
    if (!job.enabled) return null;
    if (!job.trigger || job.trigger.kind === 'manual' || job.trigger.kind === 'webhook') return null;

    const { schedule } = job.trigger as { kind: 'schedule'; schedule: AutomationSchedule | undefined };
    if (!schedule) return null;

    if (schedule.kind === 'every') {
      const everyMs = Math.floor(schedule.ms);
      if (!Number.isFinite(everyMs) || everyMs < 1_000) {
        this.markRun(job.id, 'error', 'Invalid every interval (minimum 1000ms)');
        return null;
      }
      // Recursive setTimeout instead of setInterval: each tick waits for the
      // previous run to complete, preventing pile-up when execution exceeds the interval.
      let timer: ReturnType<typeof setTimeout>;
      let stopped = false;
      const tick = () => {
        this.executeById(job.id, 'schedule')
          .catch((err) => {
            eventLogger.error('automation', 'scheduled execution failed', { jobId: job.id, error: String(err) });
          })
          .finally(() => {
            if (!stopped) timer = setTimeout(tick, everyMs);
          });
      };
      timer = setTimeout(tick, everyMs);
      return {
        stop: () => {
          stopped = true;
          clearTimeout(timer);
        },
      };
    }

    if (schedule.kind === 'at') {
      const atTs = new Date(schedule.iso).getTime();
      if (!Number.isFinite(atTs)) {
        this.markRun(job.id, 'error', 'Invalid one-time schedule');
        return null;
      }
      const delayMs = atTs - Date.now();
      if (delayMs <= 0) {
        this.markRun(job.id, 'skipped', 'One-time schedule is in the past');
        this.update(job.id, { enabled: false });
        return null;
      }
      // Chain setTimeout calls to handle delays beyond the 32-bit signed int cap
      // (~24.8 days). A single setTimeout with a larger value overflows and fires immediately.
      const MAX_DELAY_MS = 2_147_483_647;
      let timer: ReturnType<typeof setTimeout>;
      let stopped = false;
      const schedule_ = (remaining: number) => {
        const delay = Math.min(remaining, MAX_DELAY_MS);
        timer = setTimeout(() => {
          if (stopped) return;
          if (remaining <= MAX_DELAY_MS) {
            this.executeById(job.id, 'schedule').catch((err) => {
              eventLogger.error('automation', 'scheduled execution failed', { jobId: job.id, error: String(err) });
            });
          } else {
            schedule_(remaining - MAX_DELAY_MS);
          }
        }, delay);
      };
      schedule_(delayMs);
      return {
        stop: () => {
          stopped = true;
          clearTimeout(timer);
        },
      };
    }

    if (schedule.kind === 'cron') {
      if (!validateCron(schedule.expr)) {
        this.markRun(job.id, 'error', 'Invalid cron expression');
        return null;
      }
      const task = scheduleCron(schedule.expr, () => {
        this.executeById(job.id, 'schedule').catch((err) => {
          eventLogger.error('automation', 'scheduled execution failed', { jobId: job.id, error: String(err) });
        });
      });
      return { stop: () => task.stop() };
    }

    return null;
  }

  private reschedule(job: AutomationJob): void {
    this.scheduleJob(job);
  }

  private async executeById(id: string, source: 'schedule' | 'manual'): Promise<void> {
    await this.executeJob(this.get(id), source);
  }

  private async executeJob(
    job: AutomationJob,
    source: 'schedule' | 'manual' | 'webhook',
    webhookPayload?: unknown
  ): Promise<void> {
    try {
      await executeRun(job, source, webhookPayload);
      this.markRun(job.id, 'ok', undefined, source);
      eventLogger.info('automation', 'Automation executed', { id: job.id, source });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.markRun(job.id, 'error', message, source);
      eventLogger.error('automation', 'Automation execution failed', { id: job.id, source, error: message });
      throw error;
    } finally {
      // Job may have been deleted externally while running; guard before touching it.
      const updated = getAutomationJob(job.id);
      if (updated) {
        const isOneShot = updated.trigger.kind === 'schedule' && updated.trigger.schedule.kind === 'at';
        if (updated.deleteAfterRun) {
          this.remove(updated.id);
        } else if (isOneShot) {
          this.update(updated.id, { enabled: false });
        }
      }
    }
  }

  private assertValidTrigger(trigger: AutomationJob['trigger']): void {
    if (trigger.kind === 'schedule') {
      this.assertValidSchedule(trigger.schedule);
    }
  }

  private assertValidSchedule(schedule: AutomationSchedule): void {
    if (schedule.kind === 'cron') {
      if (!validateCron(schedule.expr)) throw new Error('Invalid cron expression');
      return;
    }
    if (schedule.kind === 'every') {
      if (!Number.isFinite(schedule.ms) || schedule.ms < 1_000) throw new Error('Invalid every interval (minimum 1s)');
      return;
    }
    if (schedule.kind === 'at') {
      const ts = new Date(schedule.iso).getTime();
      if (!Number.isFinite(ts)) throw new Error('Invalid one-time schedule timestamp');
    }
  }

  private markRun(
    id: string,
    status: 'ok' | 'error' | 'skipped',
    error?: string,
    trigger: 'schedule' | 'manual' | 'webhook' = 'schedule'
  ): void {
    const existing = getAutomationJob(id);
    if (!existing) return; // job deleted mid-run
    const record: AutomationRunRecord = { at: Date.now(), status, trigger, ...(error ? { error } : {}) };
    const history = [...(existing.runHistory ?? []), record].slice(-50);
    const updated: AutomationJob = {
      ...existing,
      updatedAt: Date.now(),
      lastRunAt: Date.now(),
      lastRunStatus: status,
      lastRunError: error,
      runCountOk: status === 'ok' ? (existing.runCountOk ?? 0) + 1 : (existing.runCountOk ?? 0),
      runCountError: status === 'error' ? (existing.runCountError ?? 0) + 1 : (existing.runCountError ?? 0),
      runHistory: history,
    };
    this.save(updated);
  }
}

export const automationService = new AutomationService();
