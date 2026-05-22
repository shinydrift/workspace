/**
 * Tests for utils/claudeResolver.ts — resolveClaude.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOT_FOUND_MESSAGE = 'claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code';

// ── Inlined from claudeResolver.ts with injectable deps ──────────────────────

function resolveClaude(execSyncImpl, platform) {
  try {
    const cmd = platform === 'win32' ? 'where claude' : 'which claude';
    const result = execSyncImpl(cmd, { encoding: 'utf8' }).trim().split('\n')[0];
    if (result) return result;
  } catch {
    // fall through to error
  }

  throw new Error(NOT_FOUND_MESSAGE);
}

test('resolveClaude: production source keeps the expected command selection and fallback error', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const sourcePath = path.resolve(testDir, '../../../src/main/utils/claudeResolver.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /process\.platform === 'win32' \? 'where claude' : 'which claude'/);
  assert.match(source, /\.trim\(\)\.split\('\\n'\)\[0\]/);
  assert.match(source, /throw new Error\('claude CLI not found\. Install it with: npm install -g @anthropic-ai\/claude-code'\)/);
});

test('resolveClaude: uses which on non-windows platforms', () => {
  const calls = [];
  const result = resolveClaude((cmd, options) => {
    calls.push({ cmd, options });
    return '/usr/local/bin/claude\n';
  }, 'linux');

  assert.equal(result, '/usr/local/bin/claude');
  assert.deepEqual(calls, [{ cmd: 'which claude', options: { encoding: 'utf8' } }]);
});

test('resolveClaude: uses where on win32', () => {
  const calls = [];
  const result = resolveClaude((cmd, options) => {
    calls.push({ cmd, options });
    return 'C:\\\\Users\\\\agent\\\\AppData\\\\Roaming\\\\npm\\\\claude.cmd\r\n';
  }, 'win32');

  assert.equal(result, 'C:\\\\Users\\\\agent\\\\AppData\\\\Roaming\\\\npm\\\\claude.cmd');
  assert.deepEqual(calls, [{ cmd: 'where claude', options: { encoding: 'utf8' } }]);
});

test('resolveClaude: returns the first path when multiple matches are present', () => {
  const result = resolveClaude(
    () => '/opt/homebrew/bin/claude\n/usr/local/bin/claude\n',
    'darwin'
  );

  assert.equal(result, '/opt/homebrew/bin/claude');
});

test('resolveClaude: throws install guidance when command output is empty', () => {
  assert.throws(() => resolveClaude(() => '   \n', 'linux'), new Error(NOT_FOUND_MESSAGE));
});

test('resolveClaude: throws install guidance when execSync throws', () => {
  assert.throws(
    () =>
      resolveClaude(() => {
        throw new Error('not found');
      }, 'linux'),
    new Error(NOT_FOUND_MESSAGE)
  );
});
