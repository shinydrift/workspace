/**
 * Tests for health/service.ts — status computation logic (inlined).
 * Tests the rules that map inputs to health check statuses without
 * requiring Docker, Electron, or Slack connections.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined status-computation helpers from service.ts ───────────────────────

function dockerDaemonCheck(available) {
  return {
    id: 'docker_daemon',
    label: 'Docker daemon',
    status: available ? 'ok' : 'error',
    message: available ? undefined : 'Docker is not running or not installed',
  };
}

// Sandbox image check always emits a result; warns when Docker is down.
function sandboxImageCheck(dockerAvailable, imageBuilt, imageName) {
  if (!dockerAvailable) {
    return { id: 'sandbox_image', label: 'Sandbox image', status: 'warn', message: 'Skipped — Docker not running' };
  }
  return {
    id: 'sandbox_image',
    label: 'Sandbox image',
    status: imageBuilt ? 'ok' : 'warn',
    message: imageBuilt ? `Image ${imageName} is built` : `Image ${imageName} not built yet — start a thread to build it`,
  };
}

// API keys — aggregate: ok if ≥1 configured, error if none.
function apiKeysCheck(providerConfigs, apiKeys) {
  const configured = [];
  for (const [, config] of Object.entries(providerConfigs)) {
    const key = apiKeys[config.lookupKey];
    if (key?.trim()) configured.push(config.displayName);
  }
  const total = Object.keys(providerConfigs).length;
  if (configured.length === 0) {
    return { id: 'api_keys', label: 'API keys', status: 'error', message: 'No API keys configured — add one in Settings' };
  }
  return {
    id: 'api_keys',
    label: 'API keys',
    status: 'ok',
    message: `${configured.length} of ${total} providers configured: ${configured.join(', ')}`,
  };
}

function memoryDbFallbackCheck() {
  return {
    id: 'memory_db',
    label: 'Memory DB',
    status: 'ok',
    message: 'No projects yet',
  };
}

function slackCheck(enabled, connected) {
  if (!enabled) return { id: 'slack_connection', label: 'Slack connection', status: 'ok', message: 'Disabled' };
  return {
    id: 'slack_connection',
    label: 'Slack connection',
    status: connected ? 'ok' : 'error',
    message: connected ? undefined : 'Slack is enabled but not connected — check your tokens',
  };
}

// Recent errors — time-based window filter.
function recentErrorsCheck(logs, windowMs) {
  const cutoff = Date.now() - windowMs;
  const count = logs.filter((e) => e.level === 'error' && e.ts >= cutoff).length;
  return {
    id: 'recent_errors',
    label: 'Recent errors',
    status: count === 0 ? 'ok' : count < 5 ? 'warn' : 'error',
    message:
      count === 0
        ? 'No errors in the last 15 min'
        : `${count} error(s) in the last 15 min — check Event Log for details`,
  };
}

function computeOverall(checks) {
  if (checks.some((c) => c.status === 'error')) return 'error';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'ok';
}

// ── dockerDaemonCheck ─────────────────────────────────────────────────────────

test('docker daemon available → ok', () => {
  const check = dockerDaemonCheck(true);
  assert.equal(check.status, 'ok');
  assert.equal(check.message, undefined);
});

test('docker daemon unavailable → error', () => {
  const check = dockerDaemonCheck(false);
  assert.equal(check.status, 'error');
  assert.ok(check.message.includes('Docker is not running'));
});

// ── sandboxImageCheck ─────────────────────────────────────────────────────────

test('docker available, image built → ok with image name', () => {
  const check = sandboxImageCheck(true, true, 'agentos-sandbox:latest');
  assert.equal(check.status, 'ok');
  assert.ok(check.message.includes('agentos-sandbox:latest'));
});

test('docker available, image not built → warn', () => {
  const check = sandboxImageCheck(true, false, 'agentos-sandbox:latest');
  assert.equal(check.status, 'warn');
  assert.ok(check.message.includes('not built yet'));
});

test('docker unavailable → always emits warn (skipped)', () => {
  const check = sandboxImageCheck(false, false, 'agentos-sandbox:latest');
  assert.equal(check.id, 'sandbox_image');
  assert.equal(check.status, 'warn');
  assert.ok(check.message.includes('Skipped'));
});

// ── apiKeysCheck ──────────────────────────────────────────────────────────────

const MOCK_PROVIDERS = {
  claude: { displayName: 'Claude', lookupKey: 'anthropic' },
  codex: { displayName: 'Codex', lookupKey: 'openai' },
};

test('no keys configured → error', () => {
  const check = apiKeysCheck(MOCK_PROVIDERS, { anthropic: '', openai: '' });
  assert.equal(check.status, 'error');
  assert.ok(check.message.includes('No API keys'));
});

test('no keys at all → error', () => {
  const check = apiKeysCheck(MOCK_PROVIDERS, {});
  assert.equal(check.status, 'error');
});

test('one key configured → ok with count', () => {
  const check = apiKeysCheck(MOCK_PROVIDERS, { anthropic: 'sk-ant-xxx', openai: '' });
  assert.equal(check.status, 'ok');
  assert.ok(check.message.includes('1 of 2'));
  assert.ok(check.message.includes('Claude'));
});

test('all keys configured → ok with full count', () => {
  const check = apiKeysCheck(MOCK_PROVIDERS, { anthropic: 'sk-ant-xxx', openai: 'sk-oai-xxx' });
  assert.equal(check.status, 'ok');
  assert.ok(check.message.includes('2 of 2'));
});

test('whitespace-only key → not counted as configured', () => {
  const check = apiKeysCheck(MOCK_PROVIDERS, { anthropic: '   ', openai: '' });
  assert.equal(check.status, 'error');
});

// ── slackCheck ────────────────────────────────────────────────────────────────

test('slack disabled → ok with Disabled message', () => {
  const check = slackCheck(false, false);
  assert.equal(check.status, 'ok');
  assert.equal(check.message, 'Disabled');
});

test('slack enabled and connected → ok', () => {
  const check = slackCheck(true, true);
  assert.equal(check.status, 'ok');
});

test('slack enabled but not connected → error', () => {
  const check = slackCheck(true, false);
  assert.equal(check.status, 'error');
  assert.ok(check.message.includes('not connected'));
});

// ── recentErrorsCheck ─────────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1_000;

test('zero recent errors → ok', () => {
  const check = recentErrorsCheck([], WINDOW_MS);
  assert.equal(check.status, 'ok');
  assert.ok(check.message.includes('No errors'));
});

test('old errors outside window → ok (filtered out)', () => {
  const old = { level: 'error', ts: Date.now() - WINDOW_MS - 1_000 };
  const check = recentErrorsCheck([old, old, old, old, old], WINDOW_MS);
  assert.equal(check.status, 'ok');
});

test('1-4 recent errors → warn', () => {
  for (const n of [1, 2, 3, 4]) {
    const logs = Array.from({ length: n }, () => ({ level: 'error', ts: Date.now() }));
    const check = recentErrorsCheck(logs, WINDOW_MS);
    assert.equal(check.status, 'warn', `expected warn for ${n} errors`);
    assert.ok(check.message.includes(`${n} error`));
  }
});

test('5+ recent errors → error', () => {
  for (const n of [5, 10, 50]) {
    const logs = Array.from({ length: n }, () => ({ level: 'error', ts: Date.now() }));
    const check = recentErrorsCheck(logs, WINDOW_MS);
    assert.equal(check.status, 'error', `expected error for ${n} errors`);
  }
});

test('non-error log entries ignored', () => {
  const logs = [
    { level: 'info', ts: Date.now() },
    { level: 'warn', ts: Date.now() },
    { level: 'debug', ts: Date.now() },
  ];
  const check = recentErrorsCheck(logs, WINDOW_MS);
  assert.equal(check.status, 'ok');
});

// ── memoryDbFallbackCheck ─────────────────────────────────────────────────────

test('no projects → ok with No projects yet', () => {
  const check = memoryDbFallbackCheck();
  assert.equal(check.status, 'ok');
  assert.equal(check.message, 'No projects yet');
});

// ── computeOverall ────────────────────────────────────────────────────────────

test('all ok → overall ok', () => {
  assert.equal(computeOverall([{ status: 'ok' }, { status: 'ok' }]), 'ok');
});

test('any warn, no error → overall warn', () => {
  assert.equal(computeOverall([{ status: 'ok' }, { status: 'warn' }]), 'warn');
});

test('any error → overall error regardless of other statuses', () => {
  assert.equal(computeOverall([{ status: 'ok' }, { status: 'warn' }, { status: 'error' }]), 'error');
});
