/**
 * Tests for shared/utils/subdir.ts — normalizeSubdir.
 * Pure string logic, no Electron — import the real source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubdir } from '../../src/shared/utils/subdir';

test('returns undefined for empty / blank / nullish input', () => {
  assert.equal(normalizeSubdir(undefined), undefined);
  assert.equal(normalizeSubdir(null), undefined);
  assert.equal(normalizeSubdir(''), undefined);
  assert.equal(normalizeSubdir('   '), undefined);
  assert.equal(normalizeSubdir('.'), undefined);
  assert.equal(normalizeSubdir('./'), undefined);
});

test('normalizes to a clean repo-root-relative POSIX path', () => {
  assert.equal(normalizeSubdir('apps/backend'), 'apps/backend');
  assert.equal(normalizeSubdir('  apps/backend  '), 'apps/backend');
  assert.equal(normalizeSubdir('apps/backend/'), 'apps/backend');
  assert.equal(normalizeSubdir('apps//backend'), 'apps/backend');
  assert.equal(normalizeSubdir('./apps/backend'), 'apps/backend');
});

test('converts Windows separators to POSIX', () => {
  assert.equal(normalizeSubdir('apps\\backend'), 'apps/backend');
});

test('rejects paths that escape the repo root', () => {
  assert.throws(() => normalizeSubdir('../secrets'), /stay within the repo root/);
  assert.throws(() => normalizeSubdir('apps/../../etc'), /stay within the repo root/);
});

test('rejects absolute paths', () => {
  assert.throws(() => normalizeSubdir('/etc/passwd'), /must be relative/);
  assert.throws(() => normalizeSubdir('C:\\Windows'), /must be relative/);
});
