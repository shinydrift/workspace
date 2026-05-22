import fs from 'fs';
import path from 'path';
import { clearProviderRateLimits, updateProviderRateLimits } from './providerRateLimitsStore';
import { eventLogger } from '../utils/eventLog';
import { OAUTH } from '../utils/providerConfig';
import type { RateLimitWindow } from '../../shared/types/analytics';

// Gemini usage is read from the Cloud Code quota API.
// ~/.gemini/oauth_creds.json stores Google Credentials (google-auth-library format):
//   { access_token, refresh_token, expiry_date (unix ms), token_type, scope }
// client_id/client_secret are NOT in the file — they are hardcoded public values
// in the Gemini CLI source (installed-app OAuth, not secret by design).

interface GeminiOAuthCreds {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number; // unix ms
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface QuotaBucket {
  remainingFraction?: number;
  resetTime?: string; // ISO 8601
  modelId?: string;
}

interface QuotaResponse {
  quotaBuckets?: QuotaBucket[];
}

interface ProjectListResponse {
  projects?: Array<{ projectId?: string }>;
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// In-memory cache for the access token (avoids a refresh exchange every 2 min)
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

// undefined = not yet fetched; null = fetch attempted but none found
let cachedProjectId: string | null | undefined = undefined;

function readGeminiCreds(homeDir: string): GeminiOAuthCreds | null {
  try {
    const credsPath = path.join(homeDir, '.gemini', 'oauth_creds.json');
    if (!fs.existsSync(credsPath)) return null;
    return JSON.parse(fs.readFileSync(credsPath, 'utf8')) as GeminiOAuthCreds;
  } catch {
    return null;
  }
}

async function getGeminiAccessToken(homeDir: string): Promise<string | null> {
  // Return cached token if still valid
  if (cachedAccessToken && cachedAccessToken.expiresAt - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
    return cachedAccessToken.value;
  }

  const creds = readGeminiCreds(homeDir);
  if (!creds) return null;

  // Use stored access_token if it hasn't expired yet
  if (creds.access_token && typeof creds.expiry_date === 'number') {
    if (creds.expiry_date - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
      cachedAccessToken = { value: creds.access_token, expiresAt: creds.expiry_date };
      return creds.access_token;
    }
  }

  // Exchange refresh_token using the Gemini CLI's public installed-app credentials
  if (!creds.refresh_token) return null;

  try {
    const resp = await fetch(OAUTH.gemini.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token,
        client_id: OAUTH.gemini.clientId,
        client_secret: OAUTH.gemini.clientSecret,
      }).toString(),
    });
    if (!resp.ok) {
      eventLogger.warn('geminiUsagePoller', 'Token refresh failed', { status: resp.status });
      return null;
    }
    const data = (await resp.json()) as TokenResponse;
    if (!data.access_token) return null;
    const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    cachedAccessToken = { value: data.access_token, expiresAt };
    return data.access_token;
  } catch (err) {
    eventLogger.warn('geminiUsagePoller', 'Token refresh error', { error: String(err) });
    return null;
  }
}

async function resolveProjectId(accessToken: string): Promise<string | null> {
  if (cachedProjectId !== undefined) return cachedProjectId;
  let resp: Response;
  try {
    resp = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Network error — don't cache, allow retry next refresh cycle
    return null;
  }
  if (!resp.ok) {
    // Auth/server error — don't cache so the next cycle retries with a fresh token
    return null;
  }
  const data = (await resp.json()) as ProjectListResponse;
  // Only cache once we have a definitive answer from the API
  cachedProjectId = data.projects?.[0]?.projectId ?? null;
  return cachedProjectId;
}

function modelLabel(modelId: string): string {
  return modelId.replace(/^models\//, '');
}

export async function refreshGeminiUsage(homeDir: string): Promise<void> {
  const token = await getGeminiAccessToken(homeDir);
  if (!token) {
    clearProviderRateLimits('gemini');
    return;
  }

  const projectId = await resolveProjectId(token);
  if (!projectId) {
    clearProviderRateLimits('gemini');
    return;
  }

  let resp: Response;
  try {
    resp = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: projectId }),
    });
  } catch (err) {
    eventLogger.warn('geminiUsagePoller', 'Fetch failed', { error: String(err) });
    return;
  }

  if (resp.status === 401 || resp.status === 403) {
    // Token invalid — clear in-memory token and project cache so next call retries
    cachedAccessToken = null;
    cachedProjectId = undefined;
    clearProviderRateLimits('gemini');
    return;
  }
  if (!resp.ok) {
    eventLogger.warn('geminiUsagePoller', 'Non-OK response', { status: resp.status });
    return;
  }

  let data: QuotaResponse;
  try {
    data = (await resp.json()) as QuotaResponse;
  } catch (err) {
    eventLogger.warn('geminiUsagePoller', 'Failed to parse response JSON', { error: String(err) });
    clearProviderRateLimits('gemini');
    return;
  }

  const buckets = data.quotaBuckets;
  if (!buckets || buckets.length === 0) {
    clearProviderRateLimits('gemini');
    return;
  }

  // Group by model, keep the worst (lowest remainingFraction) per model
  const byModel = new Map<string, QuotaBucket>();
  for (const bucket of buckets) {
    const id = bucket.modelId ?? 'unknown';
    const existing = byModel.get(id);
    const remaining = bucket.remainingFraction ?? 1;
    if (!existing || (existing.remainingFraction ?? 1) > remaining) {
      byModel.set(id, bucket);
    }
  }

  const windows: RateLimitWindow[] = [];
  for (const [modelId, bucket] of byModel) {
    if (typeof bucket.remainingFraction !== 'number') continue;
    const usedPercentage = Math.max(0, Math.min(100, (1 - bucket.remainingFraction) * 100));
    const resetsAt = bucket.resetTime ? Math.floor(new Date(bucket.resetTime).getTime() / 1000) : 0;
    windows.push({ label: modelLabel(modelId), usedPercentage, resetsAt });
  }

  if (windows.length > 0) {
    updateProviderRateLimits('gemini', windows);
    eventLogger.info('geminiUsagePoller', 'Updated Gemini rate limits', { windows: windows.length });
  } else {
    clearProviderRateLimits('gemini');
  }
}
