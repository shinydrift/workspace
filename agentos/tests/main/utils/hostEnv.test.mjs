/**
 * Tests for utils/hostEnv.ts — getHostShellEnv, filterEnvBySafelist, and parseEnvOutput.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Inlined from hostEnv.ts ───────────────────────────────────────────────────

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`);
}

function filterEnvBySafelist(env, patterns) {
  if (patterns.length === 0) return {};
  const regexes = patterns.map(patternToRegex);
  return Object.fromEntries(Object.entries(env).filter(([key]) => regexes.some((re) => re.test(key))));
}

function parseEnvOutput(output) {
  const result = {};
  for (const line of output.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx);
    const value = line.slice(eqIdx + 1);
    if (key) result[key] = value;
  }
  return result;
}

async function getHostShellEnv(execFileAsyncImpl, env) {
  const shell = env.SHELL ?? '/bin/sh';
  try {
    const { stdout } = await execFileAsyncImpl(shell, ['-l', '-c', 'env'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return parseEnvOutput(stdout);
  } catch {
    return Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== undefined));
  }
}

// ── getHostShellEnv ──────────────────────────────────────────────────────────

test('getHostShellEnv production source keeps the login-shell invocation and fallback filter', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const sourcePath = path.resolve(testDir, '../../../src/main/utils/hostEnv.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /const shell = process\.env\.SHELL \?\? '\/bin\/sh';/);
  assert.match(source, /execFileAsync\(shell, \['-l', '-c', 'env'\], \{/);
  assert.match(source, /timeout: 5000,/);
  assert.match(source, /maxBuffer: 1024 \* 1024,/);
  assert.match(source, /Object\.entries\(process\.env\)\.filter\(\(entry\): entry is \[string, string\] => entry\[1\] !== undefined\)/);
});

test('getHostShellEnv uses SHELL with login env command and parses stdout', async () => {
  const calls = [];
  const result = await getHostShellEnv(
    async (file, args, options) => {
      calls.push({ file, args, options });
      return {
        stdout: 'PATH=/usr/bin\nOPENAI_API_KEY=secret\n',
      };
    },
    { SHELL: '/bin/zsh' }
  );

  assert.deepEqual(result, { PATH: '/usr/bin', OPENAI_API_KEY: 'secret' });
  assert.deepEqual(calls, [
    {
      file: '/bin/zsh',
      args: ['-l', '-c', 'env'],
      options: { timeout: 5000, maxBuffer: 1024 * 1024 },
    },
  ]);
});

test('getHostShellEnv falls back to /bin/sh when SHELL is missing', async () => {
  const calls = [];
  await getHostShellEnv(
    async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: '' };
    },
    {}
  );

  assert.equal(calls[0].file, '/bin/sh');
});

test('getHostShellEnv falls back to defined process env entries on error', async () => {
  const result = await getHostShellEnv(
    async () => {
      throw new Error('spawn failed');
    },
    {
      SHELL: '/bin/bash',
      PATH: '/usr/bin',
      EMPTY: '',
      UNDEFINED: undefined,
    }
  );

  assert.deepEqual(result, {
    SHELL: '/bin/bash',
    PATH: '/usr/bin',
    EMPTY: '',
  });
});

// ── filterEnvBySafelist ───────────────────────────────────────────────────────

test('filterEnvBySafelist returns empty when patterns is empty', () => {
  const result = filterEnvBySafelist({ FOO: 'bar' }, []);
  assert.deepEqual(result, {});
});

test('filterEnvBySafelist matches exact key', () => {
  const result = filterEnvBySafelist({ GITHUB_TOKEN: 'abc', UNRELATED: 'x' }, ['GITHUB_TOKEN']);
  assert.deepEqual(result, { GITHUB_TOKEN: 'abc' });
});

test('filterEnvBySafelist glob star matches suffix', () => {
  const env = { MY_TOKEN: '1', MY_KEY: '2', OTHER: '3' };
  const result = filterEnvBySafelist(env, ['MY_*']);
  assert.deepEqual(result, { MY_TOKEN: '1', MY_KEY: '2' });
});

test('filterEnvBySafelist glob star matches prefix', () => {
  const env = { API_KEY: '1', API_SECRET: '2', SECRET: '3' };
  const result = filterEnvBySafelist(env, ['*_KEY']);
  assert.deepEqual(result, { API_KEY: '1' });
});

test('filterEnvBySafelist glob star matches anything', () => {
  const env = { A: '1', B: '2' };
  const result = filterEnvBySafelist(env, ['*']);
  assert.deepEqual(result, { A: '1', B: '2' });
});

test('filterEnvBySafelist question mark matches single char', () => {
  const env = { AB: '1', ACB: '2', A: '3' };
  const result = filterEnvBySafelist(env, ['A?']);
  assert.deepEqual(result, { AB: '1' });
});

test('filterEnvBySafelist multiple patterns union', () => {
  const env = { TOKEN_A: '1', KEY_B: '2', UNRELATED: '3' };
  const result = filterEnvBySafelist(env, ['TOKEN_*', 'KEY_*']);
  assert.deepEqual(result, { TOKEN_A: '1', KEY_B: '2' });
});

test('filterEnvBySafelist does not match partial names without wildcards', () => {
  const result = filterEnvBySafelist({ GITHUB_TOKEN: 'x', TOKEN: 'y' }, ['TOKEN']);
  assert.deepEqual(result, { TOKEN: 'y' });
});

test('filterEnvBySafelist returns empty when no keys match', () => {
  const result = filterEnvBySafelist({ FOO: 'bar', BAZ: 'qux' }, ['MISSING_*']);
  assert.deepEqual(result, {});
});

test('filterEnvBySafelist preserves values exactly', () => {
  const result = filterEnvBySafelist({ KEY: 'value with spaces=and=equals' }, ['KEY']);
  assert.equal(result.KEY, 'value with spaces=and=equals');
});

test('filterEnvBySafelist escapes regex metacharacters in literal patterns', () => {
  const env = {
    'CONFIG.JSON': 'yes',
    CONFIGXJSON: 'no',
  };
  const result = filterEnvBySafelist(env, ['CONFIG.JSON']);
  assert.deepEqual(result, { 'CONFIG.JSON': 'yes' });
});

test('filterEnvBySafelist question mark matches exactly one character', () => {
  const env = { AB: '1', A12: '2', A123: '3' };
  const result = filterEnvBySafelist(env, ['A??']);
  assert.deepEqual(result, { A12: '2' });
});

// ── parseEnvOutput ────────────────────────────────────────────────────────────

test('parseEnvOutput parses simple KEY=VALUE', () => {
  const result = parseEnvOutput('FOO=bar\nBAZ=qux\n');
  assert.deepEqual(result, { FOO: 'bar', BAZ: 'qux' });
});

test('parseEnvOutput handles values with equals signs', () => {
  const result = parseEnvOutput('URL=http://example.com?a=1&b=2');
  assert.equal(result.URL, 'http://example.com?a=1&b=2');
});

test('parseEnvOutput skips lines without equals', () => {
  const result = parseEnvOutput('NOEQUALSSIGN\nFOO=bar');
  assert.equal(result.FOO, 'bar');
  assert.equal('NOEQUALSSIGN' in result, false);
});

test('parseEnvOutput handles empty value', () => {
  const result = parseEnvOutput('EMPTY=');
  assert.equal(result.EMPTY, '');
});

test('parseEnvOutput returns empty object for empty string', () => {
  const result = parseEnvOutput('');
  assert.deepEqual(result, {});
});

test('parseEnvOutput last KEY=VALUE wins on duplicates', () => {
  const result = parseEnvOutput('FOO=first\nFOO=second');
  assert.equal(result.FOO, 'second');
});
