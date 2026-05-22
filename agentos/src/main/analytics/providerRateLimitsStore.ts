import type { RateLimitWindow, ProviderRateLimitsEntry } from '../../shared/types/analytics';

const store = new Map<string, ProviderRateLimitsEntry>();

export function updateProviderRateLimits(provider: string, windows: RateLimitWindow[]): void {
  store.set(provider, { windows, capturedAt: Date.now() });
}

export function clearProviderRateLimits(provider: string): void {
  store.delete(provider);
}

export function getProviderRateLimits(): Record<string, ProviderRateLimitsEntry> {
  return Object.fromEntries(store);
}
