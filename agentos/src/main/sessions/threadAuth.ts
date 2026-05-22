import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { eventLogger } from '../utils/eventLog';
import { OAUTH } from '../utils/providerConfig';

export const CLAUDE_OAUTH_TOKEN_URL = OAUTH.claude.tokenUrl;
export const CLAUDE_OAUTH_CLIENT_ID = OAUTH.claude.clientId;
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh if expiring within 5 min
export const CODEX_OAUTH_TOKEN_URL = OAUTH.codex.tokenUrl;
export const CODEX_OAUTH_CLIENT_ID = OAUTH.codex.clientId;
export const CODEX_TOKEN_MAX_AGE_MS = 50 * 60 * 1000; // treat as stale after 50 minutes
export const CLAUDE_CODE_OAUTH_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function readClaudeOauthToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
    return cachedToken.value;
  }

  try {
    const loginKeychain = path.join(process.env.HOME ?? '', 'Library/Keychains/login.keychain-db');
    const raw = execSync(`security find-generic-password -s "Claude Code-credentials" -w "${loginKeychain}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!raw) return null;
    const creds = JSON.parse(raw);
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return null;

    const needsRefresh = oauth.refreshToken && oauth.expiresAt && oauth.expiresAt - Date.now() < TOKEN_EXPIRY_BUFFER_MS;

    if (needsRefresh) {
      const refreshed = await refreshClaudeOauthToken(oauth.refreshToken, oauth.scopes ?? []);
      if (refreshed) {
        cachedToken = { value: refreshed, expiresAt: Date.now() + TOKEN_EXPIRY_BUFFER_MS * 2 };
        return refreshed;
      }
    }

    if (oauth.expiresAt) {
      cachedToken = { value: oauth.accessToken, expiresAt: oauth.expiresAt };
    }
    return oauth.accessToken;
  } catch {
    return null;
  }
}

export async function refreshClaudeOauthToken(refreshToken: string, scopes: string[]): Promise<string | null> {
  try {
    const body = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      scope: (scopes.length ? scopes : ['user:inference']).join(' '),
    });
    const resp = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!resp.ok) {
      eventLogger.warn('auth', 'OAuth token refresh failed', { status: resp.status });
      return null;
    }
    const data = (await resp.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    const newCreds = JSON.stringify({
      claudeAiOauth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
        scopes,
      },
    });
    const loginKeychain = path.join(process.env.HOME ?? '', 'Library/Keychains/login.keychain-db');
    const keychainResult = spawnSync(
      'security',
      [
        'add-generic-password',
        '-s',
        'Claude Code-credentials',
        '-a',
        process.env.USER || 'agentos',
        '-w',
        newCreds,
        '-U',
        loginKeychain,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    if (keychainResult.status !== 0) {
      eventLogger.error('auth', 'Failed to store token in keychain', {
        stderr: keychainResult.stderr?.toString(),
        status: keychainResult.status,
      });
      throw new Error('Keychain write failed');
    }
    eventLogger.info('auth', 'OAuth token refreshed');
    return data.access_token;
  } catch (err) {
    eventLogger.warn('auth', 'OAuth token refresh error', { error: String(err) });
    return null;
  }
}

export function hasUsableHostCodexAuth(homeDir: string): boolean {
  try {
    const authPath = path.join(homeDir, '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return false;
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed as Record<string, unknown>;

    const key = obj.OPENAI_API_KEY;
    if (typeof key === 'string' && key.trim()) return true;

    const tokens = obj.tokens;
    if (!tokens || typeof tokens !== 'object') return false;
    const accessToken = (tokens as Record<string, unknown>).access_token;
    return typeof accessToken === 'string' && accessToken.trim().length > 0;
  } catch {
    return false;
  }
}

export function hasUsableHostGeminiAuth(homeDir: string): boolean {
  try {
    const authPath = path.join(homeDir, '.gemini', 'oauth_creds.json');
    if (!fs.existsSync(authPath)) return false;
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed as Record<string, unknown>;
    const accessToken = obj.access_token;
    const refreshToken = obj.refresh_token;
    return (
      (typeof accessToken === 'string' && accessToken.trim().length > 0) ||
      (typeof refreshToken === 'string' && refreshToken.trim().length > 0)
    );
  } catch {
    return false;
  }
}

export function seedCodexAuthFromHost(homeDir: string, sessionDataDir: string): boolean {
  try {
    const authPath = path.join(homeDir, '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return false;
    fs.mkdirSync(sessionDataDir, { recursive: true });
    fs.copyFileSync(authPath, path.join(sessionDataDir, 'auth.json'));
    return true;
  } catch {
    return false;
  }
}

export function seedGeminiAuthFromHost(homeDir: string, sessionDataDir: string): boolean {
  try {
    const srcDir = path.join(homeDir, '.gemini');
    if (!hasUsableHostGeminiAuth(homeDir) || !fs.existsSync(srcDir)) return false;

    fs.mkdirSync(sessionDataDir, { recursive: true });
    const topLevelEntries = [
      'oauth_creds.json',
      'google_accounts.json',
      'settings.json',
      'state.json',
      'projects.json',
      'installation_id',
      'trustedFolders.json',
    ];
    for (const entry of topLevelEntries) {
      const srcPath = path.join(srcDir, entry);
      if (!fs.existsSync(srcPath)) continue;
      fs.copyFileSync(srcPath, path.join(sessionDataDir, entry));
    }
    return true;
  } catch {
    return false;
  }
}

export async function refreshCodexAuthIfNeeded(homeDir: string): Promise<void> {
  try {
    const authPath = path.join(homeDir, '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return;
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    if (auth.auth_mode !== 'chatgpt') return;
    const tokens = auth.tokens as Record<string, unknown> | undefined;
    if (!tokens?.refresh_token) return;

    const lastRefresh = auth.last_refresh as string | undefined;
    if (lastRefresh && Date.now() - new Date(lastRefresh).getTime() < CODEX_TOKEN_MAX_AGE_MS) return;

    const resp = await fetch(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: CODEX_OAUTH_CLIENT_ID,
      }),
    });
    if (!resp.ok) {
      eventLogger.warn('auth', 'Codex OAuth token refresh failed', { status: resp.status });
      return;
    }
    const data = (await resp.json()) as Record<string, unknown>;
    const updated = {
      ...auth,
      tokens: { ...tokens, ...data },
      last_refresh: new Date().toISOString(),
    };
    fs.writeFileSync(authPath, JSON.stringify(updated, null, 2));
    eventLogger.info('auth', 'Codex OAuth token refreshed');
  } catch (err) {
    eventLogger.warn('auth', 'Codex auth refresh error', { error: String(err) });
  }
}
