import { readClaudeOauthToken } from '../sessions/threadAuth';
import { updateProviderRateLimits } from './providerRateLimitsStore';
import { eventLogger } from '../utils/eventLog';
import type { RateLimitWindow } from '../../shared/types/analytics';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const RETRY_AFTER_429_MS = 60 * 60 * 1000; // caller should back off 1 hour on 429

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_opus: '7-day (Opus)',
  seven_day_sonnet: '7-day (Sonnet)',
};

interface UsageApiWindow {
  utilization?: number; // 0–100
  resets_at?: string; // ISO 8601
}

export interface ClaudeUsageRefreshResult {
  retryAfterMs?: number;
}

export async function refreshClaudeUsage(): Promise<ClaudeUsageRefreshResult> {
  const token = await readClaudeOauthToken();
  if (!token) return {};

  let resp: Response;
  try {
    resp = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    eventLogger.warn('claudeUsagePoller', 'Fetch error', { error: String(err) });
    return {};
  }

  if (resp.status === 429) {
    eventLogger.warn('claudeUsagePoller', 'Rate limited by usage API');
    return { retryAfterMs: RETRY_AFTER_429_MS };
  }

  if (!resp.ok) {
    eventLogger.warn('claudeUsagePoller', 'Non-OK response', { status: resp.status });
    return {};
  }

  let body: Record<string, unknown>;
  try {
    body = (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    eventLogger.warn('claudeUsagePoller', 'Failed to parse response JSON', { error: String(err) });
    return {};
  }

  const windows: RateLimitWindow[] = [];
  for (const [key, label] of Object.entries(WINDOW_LABELS)) {
    const raw = body[key] as UsageApiWindow | null | undefined;
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.utilization !== 'number' || !raw.resets_at) continue;
    const resetsAt = Math.floor(new Date(raw.resets_at).getTime() / 1000);
    if (isNaN(resetsAt)) continue;
    windows.push({ label, usedPercentage: raw.utilization, resetsAt });
  }

  if (windows.length > 0) {
    updateProviderRateLimits('claude', windows);
    eventLogger.info('claudeUsagePoller', 'Updated Claude rate limits', { windows: windows.length });
  }

  return {};
}
