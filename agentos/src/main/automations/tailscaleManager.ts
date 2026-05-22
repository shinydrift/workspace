import { spawn, type ChildProcess } from 'child_process';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';

const DAEMON_POLL_INTERVAL_MS = 500;
const DAEMON_POLL_ATTEMPTS = 10;

export class TailscaleManager {
  private daemon: ChildProcess | null = null;
  private authKey: string | null = null;
  private funnelPort: number | null = null;
  private publicBaseUrl: string | null = null;

  configure(authKey: string, funnelPort: number): void {
    this.authKey = authKey;
    this.funnelPort = funnelPort;
  }

  getPublicBaseUrl(): string | null {
    return this.publicBaseUrl;
  }

  async start(): Promise<void> {
    if (!this.authKey || !this.funnelPort) return;

    this.daemon = spawn('tailscaled', ['--state=mem:', '--tun=userspace-networking'], {
      stdio: 'ignore',
      detached: false,
    });
    this.daemon.on('error', (err: Error) => {
      eventLogger.warn('tailscale', 'tailscaled unavailable — webhook URLs will be localhost-only', {
        error: getErrorMessage(err),
      });
      this.daemon = null;
    });

    // Poll until tailscaled is ready instead of a fixed sleep.
    const ready = await pollDaemonReady(DAEMON_POLL_ATTEMPTS, DAEMON_POLL_INTERVAL_MS);
    if (!ready) {
      eventLogger.warn('tailscale', 'tailscaled did not become ready in time');
      return;
    }

    // Pass auth key via env to avoid leaking it in `ps aux` output.
    const up = await runCmd(
      'tailscale',
      ['up', '--authkey=env:TS_AUTHKEY', '--hostname=agentos-webhooks', '--accept-routes'],
      { TS_AUTHKEY: this.authKey }
    );
    if (!up.ok) {
      eventLogger.warn('tailscale', 'tailscale up failed', { error: up.error });
      return;
    }

    const funnel = await runCmd('tailscale', ['funnel', String(this.funnelPort)]);
    if (!funnel.ok) {
      eventLogger.warn('tailscale', 'tailscale funnel failed', { error: funnel.error });
      return;
    }

    const status = await runCmd('tailscale', ['status', '--json']);
    if (!status.ok) return;

    try {
      const parsed = JSON.parse(status.stdout) as { Self?: { DNSName?: string } };
      const dnsName = parsed.Self?.DNSName?.replace(/\.$/, '');
      if (dnsName) {
        this.publicBaseUrl = `https://${dnsName}`;
        eventLogger.info('tailscale', 'Tailscale Funnel active', { baseUrl: this.publicBaseUrl });
      }
    } catch {
      // ignore parse error — publicBaseUrl stays null
    }
  }

  async stop(): Promise<void> {
    if (this.funnelPort) {
      await runCmd('tailscale', ['funnel', '--remove', String(this.funnelPort)]).catch(() => {});
    }
    if (this.daemon) {
      this.daemon.kill();
      this.daemon = null;
    }
    this.publicBaseUrl = null;
  }
}

async function pollDaemonReady(attempts: number, intervalMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const result = await runCmd('tailscale', ['status', '--json']);
    if (result.ok) return true;
    await sleep(intervalMs);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCmd(
  cmd: string,
  args: string[],
  extraEnv?: Record<string, string>
): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout: Buffer.concat(chunks).toString('utf8'), error: `exit ${code}` });
    });
    child.on('error', (err: Error) => {
      resolve({ ok: false, stdout: '', error: getErrorMessage(err) });
    });
  });
}

export const tailscaleManager = new TailscaleManager();
