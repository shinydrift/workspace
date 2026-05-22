import fs from 'fs';
import dns from 'dns';
import { app } from 'electron';
import { getStore } from '../store/index';
import { getAllProjects } from '../threads/db';
import { isDockerAvailable, isImageBuilt, GLOBAL_IMAGE_NAME } from '../utils/docker';
import { getApiKey, PROVIDER_CONFIGS } from '../utils/providerConfig';
import { agentOSMemoryService } from '../memory/service';
import { slackBridge } from '../integrations/slackBridge';
import { getLogHistory } from '../utils/eventLog';
import type { AppSettings, HealthCheck, HealthReport, Provider } from '../../shared/types';

const CHECK_TIMEOUT_MS = 8_000;
const RECENT_ERROR_WINDOW_MS = 15 * 60 * 1_000;

function withTimeout<T>(p: Promise<T>, ms: number, id: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${id} check timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function runCheck(
  id: string,
  label: string,
  fn: () => Promise<Pick<HealthCheck, 'status' | 'message'>>,
): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { status, message } = await withTimeout(fn(), CHECK_TIMEOUT_MS, id);
    return { id, label, status, ...(message !== undefined ? { message } : {}), durationMs: Date.now() - start };
  } catch (err) {
    return {
      id,
      label,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

function computeOverall(checks: HealthCheck[]): 'ok' | 'warn' | 'error' {
  if (checks.some((c) => c.status === 'error')) return 'error';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'ok';
}

let inFlight: Promise<HealthReport> | null = null;

export function runHealthChecks(): Promise<HealthReport> {
  return (inFlight ??= _run().finally(() => {
    inFlight = null;
  }));
}

async function _run(): Promise<HealthReport> {
  const start = Date.now();

  let settings: AppSettings;
  try {
    settings = getStore().get('settings');
  } catch {
    settings = {} as AppSettings;
  }

  // Docker daemon — image check is chained and skipped when daemon is down.
  const dockerCheckP = runCheck('docker_daemon', 'Docker daemon', async () => {
    const available = await isDockerAvailable();
    return {
      status: available ? 'ok' : 'error',
      message: available ? undefined : 'Docker is not running or not installed',
    };
  });

  const imageCheckP = dockerCheckP.then((dockerCheck): Promise<HealthCheck> => {
    if (dockerCheck.status !== 'ok') {
      return Promise.resolve<HealthCheck>({
        id: 'sandbox_image',
        label: 'Sandbox image',
        status: 'warn',
        message: 'Skipped — Docker not running',
      });
    }
    return runCheck('sandbox_image', 'Sandbox image', async () => {
      const built = await isImageBuilt(GLOBAL_IMAGE_NAME);
      return {
        status: built ? 'ok' : 'warn',
        message: built
          ? `Image ${GLOBAL_IMAGE_NAME} is built`
          : `Image ${GLOBAL_IMAGE_NAME} not built yet — start a thread to build it`,
      };
    });
  });

  // API keys — one aggregate check rather than one row per provider.
  const apiKeysCheckP = runCheck('api_keys', 'API keys', async () => {
    const configured: string[] = [];
    for (const [provider, config] of Object.entries(PROVIDER_CONFIGS)) {
      const key = getApiKey(provider as Provider, settings.apiKeys);
      if (key?.trim()) configured.push(config.displayName);
    }
    const total = Object.keys(PROVIDER_CONFIGS).length;
    if (configured.length === 0) {
      return { status: 'error', message: 'No API keys configured — add one in Settings' };
    }
    return {
      status: 'ok',
      message: `${configured.length} of ${total} providers configured: ${configured.join(', ')}`,
    };
  });

  // Memory DB — check all projects (up to 5 most recent), not just threads[0].
  const memoryCheckP = runCheck('memory_db', 'Memory DB', async () => {
    const projects = getAllProjects().slice(0, 5);
    if (projects.length === 0) {
      return { status: 'ok', message: 'No projects yet' };
    }
    const results = await Promise.allSettled(projects.map((p) => agentOSMemoryService.doctor(p.id, null)));
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        failed.push(projects[i].name);
      } else {
        for (const c of r.value.checks) {
          if (!c.ok) failed.push(`${projects[i].name}: ${c.name}`);
        }
      }
    }
    if (failed.length === 0) {
      return { status: 'ok', message: `${projects.length} project(s) healthy` };
    }
    return { status: 'warn', message: `Issues: ${failed.join(', ')}` };
  });

  // Slack connection.
  const slackCheckP = runCheck('slack_connection', 'Slack connection', async () => {
    if (!settings.slack?.enabled) {
      return { status: 'ok', message: 'Disabled' };
    }
    const connected = slackBridge.isConnected();
    return {
      status: connected ? 'ok' : 'error',
      message: connected ? undefined : 'Slack is enabled but not connected — check your tokens',
    };
  });

  // Recent errors — time-based 15-min window, not a fixed event count.
  const errorsCheckP = runCheck('recent_errors', 'Recent errors', async () => {
    const cutoff = Date.now() - RECENT_ERROR_WINDOW_MS;
    const recentErrors = getLogHistory().filter((e) => e.level === 'error' && e.ts >= cutoff).length;
    return {
      status: recentErrors === 0 ? 'ok' : recentErrors < 5 ? 'warn' : 'error',
      message:
        recentErrors === 0
          ? 'No errors in the last 15 min'
          : `${recentErrors} error(s) in the last 15 min — check Event Log for details`,
    };
  });

  // Disk space on the app data volume.
  const diskCheckP = runCheck('disk_space', 'Disk space', async () => {
    const dir = app.getPath('userData');
    const stats = await fs.promises.statfs(dir);
    const freeBytes = stats.bavail * stats.bsize;
    const freeFmt = (freeBytes / 1024 ** 3).toFixed(1) + ' GB free';
    if (freeBytes < 100 * 1024 * 1024) {
      return { status: 'error', message: `Critical: only ${freeFmt} on app data volume` };
    }
    if (freeBytes < 1024 ** 3) {
      return { status: 'warn', message: `Low disk space: ${freeFmt}` };
    }
    return { status: 'ok', message: freeFmt };
  });

  // Network reachability via DNS lookup.
  const networkCheckP = runCheck('network', 'Network', async () => {
    await dns.promises.lookup('api.anthropic.com');
    return { status: 'ok', message: 'api.anthropic.com reachable' };
  });

  // App version — always informational.
  const versionCheckP = runCheck('app_version', 'App version', async () => ({
    status: 'ok',
    message: `v${app.getVersion()}`,
  }));

  const [docker, image, apiKeys, memory, slack, errors, disk, network, version] = await Promise.all([
    dockerCheckP,
    imageCheckP,
    apiKeysCheckP,
    memoryCheckP,
    slackCheckP,
    errorsCheckP,
    diskCheckP,
    networkCheckP,
    versionCheckP,
  ]);

  const checks = [docker, image, apiKeys, memory, slack, errors, disk, network, version];
  return { checks, ranAt: Date.now(), overall: computeOverall(checks), durationMs: Date.now() - start };
}
