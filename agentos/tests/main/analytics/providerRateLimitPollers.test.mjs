import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('provider rate limits refresh is on demand with ttl and in-flight guard', () => {
  const src = readSource('src/main/analytics/providerRateLimitRefresh.ts');
  assert.match(src, /const REFRESH_TTL_MS = 2 \* 60 \* 1000;/);
  assert.match(src, /if \(inFlight\) return inFlight;/);
  assert.match(src, /now - lastRefreshAt < REFRESH_TTL_MS/);
  assert.match(src, /refreshClaudeUsage\(\)/);
  assert.match(src, /refreshCodexUsage\(homeDir\)/);
  assert.match(src, /refreshGeminiUsage\(homeDir\)/);
});

test('geminiUsagePoller exchanges refresh_token for access_token and calls quota API', () => {
  const src = readSource('src/main/analytics/geminiUsagePoller.ts');
  assert.match(src, /export async function refreshGeminiUsage/);
  assert.match(src, /grant_type.*refresh_token/);
  assert.match(src, /OAUTH\.gemini\.clientId/);
  assert.match(src, /OAUTH\.gemini\.clientSecret/);
  assert.match(src, /cloudcode-pa\.googleapis\.com\/v1internal:retrieveUserQuota/);
  assert.match(src, /clearProviderRateLimits\('gemini'\)/);
  assert.doesNotMatch(src, /setInterval/);
});

test('provider rate limit IPC returns cache without awaiting provider network', () => {
  const src = readSource('src/main/ipc/handlers/analyticsHandlers.ts');
  assert.match(src, /void refreshProviderRateLimits\(\);/);
  assert.match(src, /return getProviderRateLimits\(\);/);
  assert.doesNotMatch(src, /await refreshProviderRateLimits\(\)/);
});

test('assistant turns force provider rate limit refresh past ttl', () => {
  const src = readSource('src/main/sessions/threadOutput.ts');
  assert.match(src, /refreshProviderRateLimits\(\{ force: true \}\)/);
});

test('claude usage refresh is fetch-on-call and exposes 429 backoff', () => {
  const src = readSource('src/main/analytics/claudeUsagePoller.ts');
  assert.match(src, /export async function refreshClaudeUsage/);
  assert.match(src, /retryAfterMs: RETRY_AFTER_429_MS/);
  assert.doesNotMatch(src, /setTimeout|setInterval/);
});

test('codexUsagePoller uses OAuth API probe and clears on missing auth or error', () => {
  const src = readSource('src/main/analytics/codexUsagePoller.ts');
  assert.match(src, /export async function refreshCodexUsage/);
  assert.match(src, /chatgpt\.com\/backend-api\/wham\/usage/);
  assert.match(src, /Authorization.*Bearer/);
  assert.match(src, /x-codex-primary-used-percent/);
  assert.match(src, /x-codex-secondary-used-percent/);
  assert.match(src, /clearProviderRateLimits\('codex'\)/);
  assert.doesNotMatch(src, /setInterval|scanSessionDir|statSync/);
});

test('shared rate limit extraction unwraps event_msg payloads for live Codex output', () => {
  const src = readSource('src/main/normalizers/types.ts');
  assert.match(src, /function unwrapRateLimitEvent\(rawEvent: Record<string, unknown>\): Record<string, unknown>/);
  assert.match(src, /rawEvent\.type === 'event_msg' && rawEvent\.payload && typeof rawEvent\.payload === 'object'/);
  assert.match(src, /return rawEvent\.payload as Record<string, unknown>;/);
});
