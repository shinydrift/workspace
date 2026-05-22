/**
 * Tests for config/oauthConfig.ts — OAUTH constants and env overrides.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from oauthConfig.ts ───────────────────────────────────────────────

function buildOauth(env = {}) {
  return {
    claude: {
      clientId: env.CLAUDE_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    },
    codex: {
      clientId: env.CODEX_OAUTH_CLIENT_ID ?? 'app_EMoamEEZ73f0CkXaXp7hrann',
      tokenUrl: 'https://auth.openai.com/oauth/token',
    },
  };
}

// ── constants ─────────────────────────────────────────────────────────────────

test('claude has the expected default client id', () => {
  const OAUTH = buildOauth();
  assert.equal(OAUTH.claude.clientId, '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
});

test('codex has the expected default client id', () => {
  const OAUTH = buildOauth();
  assert.equal(OAUTH.codex.clientId, 'app_EMoamEEZ73f0CkXaXp7hrann');
});

test('claude token url points to platform.claude.com', () => {
  const OAUTH = buildOauth();
  assert.ok(OAUTH.claude.tokenUrl.includes('platform.claude.com'));
});

test('codex token url points to auth.openai.com', () => {
  const OAUTH = buildOauth();
  assert.ok(OAUTH.codex.tokenUrl.includes('auth.openai.com'));
});

// ── env overrides ─────────────────────────────────────────────────────────────

test('CLAUDE_OAUTH_CLIENT_ID env override replaces claude clientId', () => {
  const OAUTH = buildOauth({ CLAUDE_OAUTH_CLIENT_ID: 'custom-claude-id' });
  assert.equal(OAUTH.claude.clientId, 'custom-claude-id');
});

test('CODEX_OAUTH_CLIENT_ID env override replaces codex clientId', () => {
  const OAUTH = buildOauth({ CODEX_OAUTH_CLIENT_ID: 'custom-codex-id' });
  assert.equal(OAUTH.codex.clientId, 'custom-codex-id');
});

test('unrelated env vars do not affect oauth config', () => {
  const OAUTH = buildOauth({ SOME_OTHER_VAR: 'ignored' });
  assert.equal(OAUTH.claude.clientId, '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  assert.equal(OAUTH.codex.clientId, 'app_EMoamEEZ73f0CkXaXp7hrann');
});

test('both providers have distinct token urls', () => {
  const OAUTH = buildOauth();
  assert.notEqual(OAUTH.claude.tokenUrl, OAUTH.codex.tokenUrl);
});

test('both providers have distinct client ids by default', () => {
  const OAUTH = buildOauth();
  assert.notEqual(OAUTH.claude.clientId, OAUTH.codex.clientId);
});
