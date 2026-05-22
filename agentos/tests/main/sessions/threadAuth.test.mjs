/**
 * Tests for sessions/threadAuth.ts — filesystem-based auth helpers (inlined).
 * Uses tmp directories; no keychain or network calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Inlined from threadAuth.ts ────────────────────────────────────────────────

function hasUsableHostCodexAuth(homeDir) {
  try {
    const authPath = path.join(homeDir, '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return false;
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed;

    const key = obj.OPENAI_API_KEY;
    if (typeof key === 'string' && key.trim()) return true;

    const tokens = obj.tokens;
    if (!tokens || typeof tokens !== 'object') return false;
    const accessToken = tokens.access_token;
    return typeof accessToken === 'string' && accessToken.trim().length > 0;
  } catch {
    return false;
  }
}

function hasUsableHostGeminiAuth(homeDir) {
  try {
    const authPath = path.join(homeDir, '.gemini', 'oauth_creds.json');
    if (!fs.existsSync(authPath)) return false;
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const obj = parsed;
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

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-auth-test-'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

// ── hasUsableHostCodexAuth ────────────────────────────────────────────────────

test('codex: false when .codex/auth.json does not exist', () => {
  const home = makeTmpHome();
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('codex: true when OPENAI_API_KEY is present', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.codex', 'auth.json'), { OPENAI_API_KEY: 'sk-test-key' });
  assert.equal(hasUsableHostCodexAuth(home), true);
  fs.rmSync(home, { recursive: true });
});

test('codex: false when OPENAI_API_KEY is empty string', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.codex', 'auth.json'), { OPENAI_API_KEY: '   ' });
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('codex: true when tokens.access_token is present', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.codex', 'auth.json'), { tokens: { access_token: 'tok-abc' } });
  assert.equal(hasUsableHostCodexAuth(home), true);
  fs.rmSync(home, { recursive: true });
});

test('codex: false when tokens.access_token is empty', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.codex', 'auth.json'), { tokens: { access_token: '' } });
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('codex: false when tokens present but no access_token key', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.codex', 'auth.json'), { tokens: { refresh_token: 'ref-tok' } });
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('codex: false when auth.json is not valid JSON', () => {
  const home = makeTmpHome();
  const authPath = path.join(home, '.codex', 'auth.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, 'not json at all');
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('codex: false when auth.json contains a non-object (array)', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.codex', 'auth.json'), [1, 2, 3]);
  // arrays are objects in JS, but no OPENAI_API_KEY or tokens fields → false
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('codex: false when auth.json contains null', () => {
  const home = makeTmpHome();
  const authPath = path.join(home, '.codex', 'auth.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, 'null');
  assert.equal(hasUsableHostCodexAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

// ── hasUsableHostGeminiAuth ───────────────────────────────────────────────────

test('gemini: false when .gemini/oauth_creds.json does not exist', () => {
  const home = makeTmpHome();
  assert.equal(hasUsableHostGeminiAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('gemini: true when access_token is present', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.gemini', 'oauth_creds.json'), { access_token: 'gm-access-tok' });
  assert.equal(hasUsableHostGeminiAuth(home), true);
  fs.rmSync(home, { recursive: true });
});

test('gemini: true when only refresh_token is present', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.gemini', 'oauth_creds.json'), { refresh_token: 'gm-refresh-tok' });
  assert.equal(hasUsableHostGeminiAuth(home), true);
  fs.rmSync(home, { recursive: true });
});

test('gemini: false when both tokens are empty strings', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.gemini', 'oauth_creds.json'), { access_token: '', refresh_token: '' });
  assert.equal(hasUsableHostGeminiAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('gemini: false when both tokens are missing', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.gemini', 'oauth_creds.json'), { other_key: 'value' });
  assert.equal(hasUsableHostGeminiAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('gemini: false when oauth_creds.json is not valid JSON', () => {
  const home = makeTmpHome();
  const authPath = path.join(home, '.gemini', 'oauth_creds.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, '{bad json}');
  assert.equal(hasUsableHostGeminiAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('gemini: false when oauth_creds.json contains null', () => {
  const home = makeTmpHome();
  const authPath = path.join(home, '.gemini', 'oauth_creds.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, 'null');
  assert.equal(hasUsableHostGeminiAuth(home), false);
  fs.rmSync(home, { recursive: true });
});

test('gemini: false when access_token is whitespace only', () => {
  const home = makeTmpHome();
  writeJson(path.join(home, '.gemini', 'oauth_creds.json'), { access_token: '   ' });
  assert.equal(hasUsableHostGeminiAuth(home), false);
  fs.rmSync(home, { recursive: true });
});
