import { app } from 'electron';
import { eventLogger } from '../utils/eventLog';
import { refreshClaudeUsage } from './claudeUsagePoller';
import { refreshCodexUsage } from './codexUsagePoller';
import { refreshGeminiUsage } from './geminiUsagePoller';

const REFRESH_TTL_MS = 2 * 60 * 1000;

let configuredHomeDir: string | null = null;
let lastRefreshAt = 0;
let inFlight: Promise<void> | null = null;
let claudeBackoffUntil = 0;

export function initProviderRateLimitRefresh(homeDir: string): void {
  configuredHomeDir = homeDir;
  refreshProviderRateLimits({ force: true }).catch((error: unknown) => {
    eventLogger.warn('providerRateLimitRefresh', 'Startup refresh failed', { error: String(error) });
  });
}

export async function refreshProviderRateLimits(options: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (!options.force && now - lastRefreshAt < REFRESH_TTL_MS) return;

  const homeDir = configuredHomeDir ?? app.getPath('home');
  inFlight = (async () => {
    if (now >= claudeBackoffUntil) {
      try {
        const claude = await refreshClaudeUsage();
        if (claude.retryAfterMs) claudeBackoffUntil = Date.now() + claude.retryAfterMs;
      } catch (error) {
        eventLogger.warn('providerRateLimitRefresh', 'Claude refresh failed', { error: String(error) });
      }
    }
    await Promise.allSettled([
      refreshCodexUsage(homeDir).catch((error: unknown) => {
        eventLogger.warn('providerRateLimitRefresh', 'Codex refresh failed', { error: String(error) });
      }),
      refreshGeminiUsage(homeDir).catch((error: unknown) => {
        eventLogger.warn('providerRateLimitRefresh', 'Gemini refresh failed', { error: String(error) });
      }),
    ]);
    lastRefreshAt = Date.now();
  })()
    .catch((error: unknown) => {
      eventLogger.warn('providerRateLimitRefresh', 'Refresh failed', { error: String(error) });
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
