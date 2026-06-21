/**
 * Tests for sessions/effectiveCwd.ts — effectiveHostCwd.
 * Pure (only imports 'path'), no Electron — import the real source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveHostCwd, claudeProjectDirName } from '../../src/main/sessions/effectiveCwd';

test('descends into the subdir on host execution', () => {
  assert.equal(effectiveHostCwd('/repo', 'apps/backend', true), '/repo/apps/backend');
});

test('normalizes messy subdir before joining', () => {
  assert.equal(effectiveHostCwd('/repo', 'apps/backend/', true), '/repo/apps/backend');
  assert.equal(effectiveHostCwd('/repo', './apps//backend', true), '/repo/apps/backend');
});

test('returns the mount root when no subdir is set', () => {
  assert.equal(effectiveHostCwd('/repo', undefined, true), '/repo');
  assert.equal(effectiveHostCwd('/repo', '', true), '/repo');
});

test('ignores subdir under Docker (cwd is set by the container workdir)', () => {
  assert.equal(effectiveHostCwd('/repo', 'apps/backend', false), '/repo');
});

test('rejects subdir that escapes the repo root', () => {
  assert.throws(() => effectiveHostCwd('/repo', '../escape', true), /stay within the repo root/);
});

test('claudeProjectDirName slugs the container workdir under Docker', () => {
  assert.equal(claudeProjectDirName('/repo', 'apps/backend', false), '-workspace-apps-backend');
  assert.equal(claudeProjectDirName('/repo', undefined, false), '-workspace');
});

test('claudeProjectDirName slugs the real host cwd on host', () => {
  assert.equal(claudeProjectDirName('/repo', 'apps/backend', true), '-repo-apps-backend');
  assert.equal(claudeProjectDirName('/repo', undefined, true), '-repo');
});
