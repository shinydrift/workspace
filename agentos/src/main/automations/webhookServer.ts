import http from 'http';
import crypto from 'crypto';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { webhookQueue } from './webhookQueue';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
const VALID_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);
const SIGNATURE_MAX_AGE_SECONDS = 300;

export class WebhookServer {
  private server: http.Server | null = null;
  private jobSecrets = new Map<string, string>();
  private jobSources = new Map<string, string | undefined>();

  registerJob(jobId: string, secret: string, source?: string): void {
    this.jobSecrets.set(jobId, secret);
    this.jobSources.set(jobId, source);
  }

  unregisterJob(jobId: string): void {
    this.jobSecrets.delete(jobId);
    this.jobSources.delete(jobId);
  }

  start(port: number): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      const match = req.url?.match(/^\/webhook\/([^/]+)$/);
      if (!match) {
        res.writeHead(404);
        res.end();
        return;
      }
      let jobId: string;
      try {
        jobId = decodeURIComponent(match[1]);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (!VALID_JOB_ID.test(jobId)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const secret = this.jobSecrets.get(jobId);
      if (secret === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytesReceived = 0;
      req.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_BODY_BYTES) {
          res.writeHead(413);
          res.end();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          const lower = k.toLowerCase();
          if (typeof v === 'string' && !SENSITIVE_HEADERS.has(lower)) headers[lower] = v;
        }
        if (!verifySignature(body, secret, headers)) {
          res.writeHead(401);
          res.end();
          eventLogger.warn('webhook', 'Signature verification failed', { jobId });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(body.toString('utf8'));
        } catch {
          payload = body.toString('utf8');
        }
        res.writeHead(202);
        res.end();
        const source = this.jobSources.get(jobId);
        webhookQueue.enqueue(jobId, source, payload, headers).catch((err: unknown) => {
          eventLogger.error('webhook', 'Failed to enqueue webhook event', {
            jobId,
            error: getErrorMessage(err),
          });
        });
      });
      req.on('error', (err: Error) => {
        eventLogger.error('webhook', 'Request error', { error: getErrorMessage(err) });
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end();
        }
      });
    });
    this.server.listen(port, () => {
      eventLogger.info('webhook', `Webhook server listening on port ${port}`);
    });
    this.server.on('error', (err: Error) => {
      eventLogger.error('webhook', 'Webhook server error', { error: getErrorMessage(err) });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

function verifySignature(body: Buffer, secret: string, headers: Record<string, string>): boolean {
  // GitHub: x-hub-signature-256: sha256=<hex>
  const githubSig = headers['x-hub-signature-256'];
  if (githubSig) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    return timingSafeEqual(githubSig, expected);
  }

  // Stripe: stripe-signature: t=<ts>,v1=<hex>[,v1=<hex>...]
  // Values may contain '=' (base64), so split on first '=' only per token.
  const stripeSig = headers['stripe-signature'];
  if (stripeSig) {
    let timestamp: string | undefined;
    const v1Sigs: string[] = [];
    for (const token of stripeSig.split(',')) {
      const eq = token.indexOf('=');
      if (eq === -1) continue;
      const key = token.slice(0, eq);
      const val = token.slice(eq + 1);
      if (key === 't') timestamp = val;
      else if (key === 'v1') v1Sigs.push(val);
    }
    if (!timestamp || v1Sigs.length === 0) return false;
    const stripeTs = parseInt(timestamp, 10);
    if (!Number.isFinite(stripeTs) || Math.abs(Date.now() / 1000 - stripeTs) > SIGNATURE_MAX_AGE_SECONDS) return false;
    const signedPayload = `${timestamp}.${body.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    return v1Sigs.some((sig) => timingSafeEqual(sig, expected));
  }

  // Slack: x-slack-signature: v0=<hex> + x-slack-request-timestamp
  const slackSig = headers['x-slack-signature'];
  const slackTs = headers['x-slack-request-timestamp'];
  if (slackSig && slackTs) {
    const slackTsNum = parseInt(slackTs, 10);
    if (!Number.isFinite(slackTsNum) || Math.abs(Date.now() / 1000 - slackTsNum) > SIGNATURE_MAX_AGE_SECONDS)
      return false;
    const signedPayload = `v0:${slackTs}:${body.toString('utf8')}`;
    const expected = 'v0=' + crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    return timingSafeEqual(slackSig, expected);
  }

  // Generic: x-webhook-signature: sha256=<hex>
  const genericSig = headers['x-webhook-signature'];
  if (genericSig) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    return timingSafeEqual(genericSig, expected);
  }

  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const webhookServer = new WebhookServer();
