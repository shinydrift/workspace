import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import {
  insertWebhookEvent,
  updateWebhookEventStatus,
  getPendingWebhookEvents,
  resetProcessingWebhookEvents,
  deleteOldWebhookEvents,
  type WebhookEventRow,
} from '../threads/db';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

type WebhookProcessor = (
  jobId: string,
  source: string | null,
  payload: unknown,
  headers: Record<string, string>
) => Promise<void>;

const PAYLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class WebhookQueue {
  private webhooksDir: string | null = null;
  private processor: WebhookProcessor | null = null;
  // Per-job FIFO: chain promises so concurrent deliveries for the same job process serially.
  private jobChains = new Map<string, Promise<void>>();

  init(homeDir: string): void {
    this.webhooksDir = path.join(homeDir, '.agentos', 'webhooks');
    fs.mkdirSync(this.webhooksDir, { recursive: true });
  }

  setProcessor(fn: WebhookProcessor): void {
    this.processor = fn;
  }

  async enqueue(
    jobId: string,
    source: string | undefined,
    payload: unknown,
    headers: Record<string, string>
  ): Promise<void> {
    if (!this.webhooksDir) throw new Error('WebhookQueue not initialized — call init(homeDir) before start()');

    const id = nanoid();
    const jobDir = path.join(this.webhooksDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const payloadPath = path.join(jobDir, `${id}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf8');

    insertWebhookEvent({
      id,
      jobId,
      source: source ?? null,
      payloadPath,
      headers,
      receivedAt: Date.now(),
    });

    eventLogger.info('webhook', 'Event queued', { id, jobId, source });
    this.enqueueForJob(id, jobId, source ?? null, payload, headers);
  }

  async replayPending(): Promise<void> {
    this.pruneOldPayloads();

    // Single-process Electron: no worker can hold a 'processing' lock at startup,
    // so any processing events are stale from a prior crash. Reset them all to pending.
    resetProcessingWebhookEvents();

    const pending = getPendingWebhookEvents();
    if (pending.length === 0) return;
    eventLogger.info('webhook', 'Replaying pending webhook events', { count: pending.length });
    for (const event of pending) {
      try {
        this.replayEvent(event);
      } catch (err) {
        eventLogger.error('webhook', 'Replay error', { id: event.id, error: getErrorMessage(err) });
      }
    }
  }

  private pruneOldPayloads(): void {
    try {
      const paths = deleteOldWebhookEvents(PAYLOAD_TTL_MS);
      for (const p of paths) {
        try {
          fs.unlinkSync(p);
        } catch {
          // already gone — ignore
        }
      }
      if (paths.length > 0) {
        eventLogger.info('webhook', 'Pruned old webhook payload files', { count: paths.length });
      }
    } catch (err) {
      eventLogger.warn('webhook', 'Payload prune failed', { error: getErrorMessage(err) });
    }
  }

  private enqueueForJob(
    id: string,
    jobId: string,
    source: string | null,
    payload: unknown,
    headers: Record<string, string>
  ): void {
    const prev = this.jobChains.get(jobId) ?? Promise.resolve();
    const next = prev
      .then(() => this.processEvent(id, jobId, source, payload, headers))
      .catch((err) => {
        eventLogger.error('webhook', 'Queue processing error', { id, error: getErrorMessage(err) });
      });
    this.jobChains.set(jobId, next);
    // Clean up the chain entry once this link settles so the map doesn't grow unbounded.
    next.finally(() => {
      if (this.jobChains.get(jobId) === next) this.jobChains.delete(jobId);
    });
  }

  private replayEvent(event: WebhookEventRow): void {
    let payload: unknown = null;
    try {
      const raw = fs.readFileSync(event.payloadPath, 'utf8');
      payload = JSON.parse(raw);
    } catch (err) {
      eventLogger.warn('webhook', 'Could not read payload file for replay', {
        id: event.id,
        path: event.payloadPath,
        error: getErrorMessage(err),
      });
    }
    this.enqueueForJob(event.id, event.jobId, event.source, payload, event.headers);
  }

  private async processEvent(
    id: string,
    jobId: string,
    source: string | null,
    payload: unknown,
    headers: Record<string, string>
  ): Promise<void> {
    updateWebhookEventStatus(id, 'processing');
    try {
      if (!this.processor) throw new Error('No processor registered');
      await this.processor(jobId, source, payload, headers);
      updateWebhookEventStatus(id, 'processed');
      eventLogger.info('webhook', 'Event processed', { id, jobId });
    } catch (err) {
      const error = getErrorMessage(err);
      updateWebhookEventStatus(id, 'failed', error);
      eventLogger.error('webhook', 'Event processing failed', { id, jobId, error });
    }
  }
}

export const webhookQueue = new WebhookQueue();
