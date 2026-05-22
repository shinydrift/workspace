/**
 * Tests for sessions/threadAuth.ts — hasUsableHostCodexAuth, hasUsableHostGeminiAuth,
 * seedCodexAuthFromHost, seedGeminiAuthFromHost.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

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

function seedCodexAuthFromHost(homeDir, sessionDataDir) {
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

function seedGeminiAuthFromHost(homeDir, sessionDataDir) {
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

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-auth-test-'));
}

// ── hasUsableHostCodexAuth ────────────────────────────────────────────────────

test('hasUsableHostCodexAuth returns false when .codex/auth.json missing', () => {
  const home = makeTmp();
  try {
    assert.equal(hasUsableHostCodexAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostCodexAuth returns true with OPENAI_API_KEY', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test' }));
    assert.equal(hasUsableHostCodexAuth(home), true);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostCodexAuth returns false with empty OPENAI_API_KEY', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: '   ' }));
    assert.equal(hasUsableHostCodexAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostCodexAuth returns true with tokens.access_token', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(
      path.join(home, '.codex', 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'eyJhbc' } })
    );
    assert.equal(hasUsableHostCodexAuth(home), true);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostCodexAuth returns false with empty tokens.access_token', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: '' } }));
    assert.equal(hasUsableHostCodexAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostCodexAuth returns false with invalid JSON', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), 'not-json');
    assert.equal(hasUsableHostCodexAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

// ── hasUsableHostGeminiAuth ───────────────────────────────────────────────────

test('hasUsableHostGeminiAuth returns false when file missing', () => {
  const home = makeTmp();
  try {
    assert.equal(hasUsableHostGeminiAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostGeminiAuth returns true with access_token', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(
      path.join(home, '.gemini', 'oauth_creds.json'),
      JSON.stringify({ access_token: 'ya29.abc' })
    );
    assert.equal(hasUsableHostGeminiAuth(home), true);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostGeminiAuth returns true with only refresh_token', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(
      path.join(home, '.gemini', 'oauth_creds.json'),
      JSON.stringify({ refresh_token: '1//refresh' })
    );
    assert.equal(hasUsableHostGeminiAuth(home), true);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostGeminiAuth returns false with empty tokens', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(
      path.join(home, '.gemini', 'oauth_creds.json'),
      JSON.stringify({ access_token: '', refresh_token: '' })
    );
    assert.equal(hasUsableHostGeminiAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test('hasUsableHostGeminiAuth returns false with invalid JSON', () => {
  const home = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{{invalid}}');
    assert.equal(hasUsableHostGeminiAuth(home), false);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

// ── seedCodexAuthFromHost ─────────────────────────────────────────────────────

test('seedCodexAuthFromHost returns false when auth.json missing', () => {
  const home = makeTmp();
  const dest = makeTmp();
  try {
    assert.equal(seedCodexAuthFromHost(home, dest), false);
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(dest, { recursive: true });
  }
});

test('seedCodexAuthFromHost copies auth.json to session dir', () => {
  const home = makeTmp();
  const dest = makeTmp();
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-x' }));
    const result = seedCodexAuthFromHost(home, dest);
    assert.equal(result, true);
    assert.ok(fs.existsSync(path.join(dest, 'auth.json')));
    const copied = JSON.parse(fs.readFileSync(path.join(dest, 'auth.json'), 'utf8'));
    assert.equal(copied.OPENAI_API_KEY, 'sk-x');
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(dest, { recursive: true });
  }
});

// ── seedGeminiAuthFromHost ────────────────────────────────────────────────────

test('seedGeminiAuthFromHost returns false when no usable auth', () => {
  const home = makeTmp();
  const dest = makeTmp();
  try {
    assert.equal(seedGeminiAuthFromHost(home, dest), false);
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(dest, { recursive: true });
  }
});

test('seedGeminiAuthFromHost copies known files to session dir', () => {
  const home = makeTmp();
  const dest = makeTmp();
  try {
    const geminiDir = path.join(home, '.gemini');
    fs.mkdirSync(geminiDir);
    fs.writeFileSync(path.join(geminiDir, 'oauth_creds.json'), JSON.stringify({ access_token: 'tok' }));
    fs.writeFileSync(path.join(geminiDir, 'settings.json'), '{}');

    const result = seedGeminiAuthFromHost(home, dest);
    assert.equal(result, true);
    assert.ok(fs.existsSync(path.join(dest, 'oauth_creds.json')));
    assert.ok(fs.existsSync(path.join(dest, 'settings.json')));
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(dest, { recursive: true });
  }
});

test('seedGeminiAuthFromHost skips files that do not exist', () => {
  const home = makeTmp();
  const dest = makeTmp();
  try {
    const geminiDir = path.join(home, '.gemini');
    fs.mkdirSync(geminiDir);
    fs.writeFileSync(path.join(geminiDir, 'oauth_creds.json'), JSON.stringify({ access_token: 'tok' }));
    // google_accounts.json intentionally absent

    const result = seedGeminiAuthFromHost(home, dest);
    assert.equal(result, true);
    assert.equal(fs.existsSync(path.join(dest, 'google_accounts.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(dest, { recursive: true });
  }
});
