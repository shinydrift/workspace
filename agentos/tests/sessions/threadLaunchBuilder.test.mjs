/**
 * Tests for sessions/threadLaunchBuilder.ts — extraEnv assembly logic.
 * The env-construction block is inlined; the full buildThreadLaunchArgs
 * function is Electron-coupled and not tested here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined env-assembly from buildThreadLaunchArgs ───────────────────────────
//
// Mirrors the extraEnv spread block in threadLaunchBuilder.ts:
//
//   {
//     ...(envSafelist && envSafelist.length > 0 ? filterEnvBySafelist(hostEnv, envSafelist) : {}),
//     ...(extraEnv ?? {}),
//     ...(tailscaleAuthKey ? { TS_AUTHKEY, TS_HOSTNAME, [TS_FUNNEL_PORT] } : {}),
//     ...(githubToken ? { GH_TOKEN: githubToken } : {}),
//   }

function buildExtraEnv({ hostEnv = {}, envSafelist, extraEnv, tailscaleAuthKey, tailscaleFunnel, githubToken, threadId }) {
  return {
    ...(envSafelist && envSafelist.length > 0 ? filterEnvBySafelist(hostEnv, envSafelist) : {}),
    ...(extraEnv ?? {}),
    ...(tailscaleAuthKey
      ? {
          TS_AUTHKEY: tailscaleAuthKey,
          TS_HOSTNAME: `agentos-${threadId.slice(0, 8)}`,
          ...(tailscaleFunnel ? { TS_FUNNEL_PORT: '3000' } : {}),
        }
      : {}),
    ...(githubToken ? { GH_TOKEN: githubToken } : {}),
  };
}

// minimal filterEnvBySafelist (exact logic from hostEnv.ts)
function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

function filterEnvBySafelist(env, patterns) {
  if (patterns.length === 0) return {};
  const regexes = patterns.map(patternToRegex);
  return Object.fromEntries(Object.entries(env).filter(([key]) => regexes.some((re) => re.test(key))));
}

// ── tailscale vars ────────────────────────────────────────────────────────────

test('tailscaleAuthKey absent → no TS_ vars', () => {
  const env = buildExtraEnv({ threadId: 'abc123' });
  assert.ok(!('TS_AUTHKEY' in env));
  assert.ok(!('TS_HOSTNAME' in env));
  assert.ok(!('TS_FUNNEL_PORT' in env));
});

test('tailscaleAuthKey present → TS_AUTHKEY and TS_HOSTNAME set', () => {
  const env = buildExtraEnv({ threadId: 'abc123', tailscaleAuthKey: 'tskey-abc' });
  assert.equal(env.TS_AUTHKEY, 'tskey-abc');
  assert.equal(env.TS_HOSTNAME, 'agentos-abc123');
});

test('TS_HOSTNAME uses first 8 chars of threadId', () => {
  const env = buildExtraEnv({ threadId: 'abcdefghijklmnop', tailscaleAuthKey: 'k' });
  assert.equal(env.TS_HOSTNAME, 'agentos-abcdefgh');
});

test('tailscaleFunnel true → TS_FUNNEL_PORT is "3000"', () => {
  const env = buildExtraEnv({ threadId: 'abc123', tailscaleAuthKey: 'k', tailscaleFunnel: true });
  assert.equal(env.TS_FUNNEL_PORT, '3000');
});

test('tailscaleFunnel false → no TS_FUNNEL_PORT', () => {
  const env = buildExtraEnv({ threadId: 'abc123', tailscaleAuthKey: 'k', tailscaleFunnel: false });
  assert.ok(!('TS_FUNNEL_PORT' in env));
});

test('tailscaleFunnel undefined → no TS_FUNNEL_PORT', () => {
  const env = buildExtraEnv({ threadId: 'abc123', tailscaleAuthKey: 'k' });
  assert.ok(!('TS_FUNNEL_PORT' in env));
});

// ── github token ──────────────────────────────────────────────────────────────

test('githubToken present → GH_TOKEN set', () => {
  const env = buildExtraEnv({ threadId: 'abc', githubToken: 'ghp_xxx' });
  assert.equal(env.GH_TOKEN, 'ghp_xxx');
});

test('githubToken absent → no GH_TOKEN', () => {
  const env = buildExtraEnv({ threadId: 'abc' });
  assert.ok(!('GH_TOKEN' in env));
});

test('githubToken null → no GH_TOKEN', () => {
  const env = buildExtraEnv({ threadId: 'abc', githubToken: null });
  assert.ok(!('GH_TOKEN' in env));
});

// ── merge priority ────────────────────────────────────────────────────────────

test('tailscale vars override extraEnv keys', () => {
  const env = buildExtraEnv({
    threadId: 'abc123',
    tailscaleAuthKey: 'real-key',
    extraEnv: { TS_AUTHKEY: 'overridden' },
  });
  assert.equal(env.TS_AUTHKEY, 'real-key');
});

test('githubToken overrides extraEnv GH_TOKEN', () => {
  const env = buildExtraEnv({
    threadId: 'abc',
    githubToken: 'ghp_real',
    extraEnv: { GH_TOKEN: 'overridden' },
  });
  assert.equal(env.GH_TOKEN, 'ghp_real');
});

test('extraEnv overrides host safelist env', () => {
  const env = buildExtraEnv({
    threadId: 'abc',
    hostEnv: { MY_VAR: 'from-host' },
    envSafelist: ['MY_VAR'],
    extraEnv: { MY_VAR: 'from-extra' },
  });
  assert.equal(env.MY_VAR, 'from-extra');
});

// ── env safelist ──────────────────────────────────────────────────────────────

test('empty envSafelist → no host env leaked', () => {
  const env = buildExtraEnv({
    threadId: 'abc',
    hostEnv: { SECRET: 'value' },
    envSafelist: [],
  });
  assert.ok(!('SECRET' in env));
});

test('envSafelist undefined → no host env leaked', () => {
  const env = buildExtraEnv({
    threadId: 'abc',
    hostEnv: { SECRET: 'value' },
  });
  assert.ok(!('SECRET' in env));
});

test('envSafelist with glob passes matching keys', () => {
  const env = buildExtraEnv({
    threadId: 'abc',
    hostEnv: { MY_TOKEN: 'tok', MY_KEY: 'key', UNRELATED: 'x' },
    envSafelist: ['MY_*'],
  });
  assert.equal(env.MY_TOKEN, 'tok');
  assert.equal(env.MY_KEY, 'key');
  assert.ok(!('UNRELATED' in env));
});

test('empty result when no params provided', () => {
  const env = buildExtraEnv({ threadId: 'abc' });
  assert.deepEqual(env, {});
});
