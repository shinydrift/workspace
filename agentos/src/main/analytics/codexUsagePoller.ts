import fs from 'fs';
import path from 'path';
import { clearProviderRateLimits, updateProviderRateLimits } from './providerRateLimitsStore';
import { eventLogger } from '../utils/eventLog';
import type { RateLimitWindow } from '../../shared/types/analytics';

// Codex usage is read from the ChatGPT wham/usage API using the OAuth token
// stored in ~/.codex/auth.json (auth_mode: 'chatgpt' sessions only).

interface CodexAuth {
  auth_mode?: string;
  tokens?: { access_token?: string };
}

interface CodexWhamWindow {
  used_percent?: number;
  window_minutes?: number;
  reset_at?: number; // unix seconds or ms
  reset_after_seconds?: number;
}

interface CodexWhamBody {
  rate_limit?: {
    primary_window?: CodexWhamWindow;
    secondary_window?: CodexWhamWindow;
  };
}

function readCodexAccessToken(homeDir: string): string | null {
  try {
    const authPath = path.join(homeDir, '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return null;
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8')) as CodexAuth;
    const token = auth.tokens?.access_token;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

function windowLabel(minutes: number | undefined): string {
  if (!minutes) return 'window';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}-hour`;
  const days = Math.round(hours / 24);
  return `${days}-day`;
}

function resetsAtFromWindow(w: CodexWhamWindow): number {
  if (typeof w.reset_at === 'number' && Number.isFinite(w.reset_at)) {
    const secs = w.reset_at > 10_000_000_000 ? Math.floor(w.reset_at / 1000) : Math.floor(w.reset_at);
    return secs > Math.floor(Date.now() / 1000) ? secs : 0;
  }
  if (typeof w.reset_after_seconds === 'number') {
    return Math.floor(Date.now() / 1000) + w.reset_after_seconds;
  }
  return 0;
}

export async function refreshCodexUsage(homeDir: string): Promise<void> {
  const token = readCodexAccessToken(homeDir);
  if (!token) {
    clearProviderRateLimits('codex');
    return;
  }

  let resp: Response;
  try {
    resp = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    eventLogger.warn('codexUsagePoller', 'Fetch failed', { error: String(err) });
    return;
  }

  if (resp.status === 401 || resp.status === 403) {
    clearProviderRateLimits('codex');
    return;
  }
  if (!resp.ok) {
    eventLogger.warn('codexUsagePoller', 'Non-OK response', { status: resp.status });
    return;
  }

  const windows: RateLimitWindow[] = [];

  // Prefer response headers — lower-overhead than parsing JSON body
  const primaryHeader = resp.headers.get('x-codex-primary-used-percent');
  const secondaryHeader = resp.headers.get('x-codex-secondary-used-percent');

  if (primaryHeader !== null || secondaryHeader !== null) {
    if (primaryHeader !== null) {
      const pct = parseFloat(primaryHeader);
      if (Number.isFinite(pct)) windows.push({ label: '5-hour', usedPercentage: pct, resetsAt: 0 });
    }
    if (secondaryHeader !== null) {
      const pct = parseFloat(secondaryHeader);
      if (Number.isFinite(pct)) windows.push({ label: 'weekly', usedPercentage: pct, resetsAt: 0 });
    }
  } else {
    let body: CodexWhamBody;
    try {
      body = (await resp.json()) as CodexWhamBody;
    } catch (err) {
      eventLogger.warn('codexUsagePoller', 'Failed to parse response JSON', { error: String(err) });
      clearProviderRateLimits('codex');
      return;
    }
    const primary = body.rate_limit?.primary_window;
    const secondary = body.rate_limit?.secondary_window;
    if (primary && typeof primary.used_percent === 'number') {
      windows.push({
        label: windowLabel(primary.window_minutes ?? 300),
        usedPercentage: primary.used_percent,
        resetsAt: resetsAtFromWindow(primary),
      });
    }
    if (secondary && typeof secondary.used_percent === 'number') {
      windows.push({
        label: windowLabel(secondary.window_minutes ?? 10_080),
        usedPercentage: secondary.used_percent,
        resetsAt: resetsAtFromWindow(secondary),
      });
    }
  }

  if (windows.length > 0) {
    updateProviderRateLimits('codex', windows);
    eventLogger.info('codexUsagePoller', 'Updated Codex rate limits', { windows: windows.length });
  } else {
    clearProviderRateLimits('codex');
  }
}
