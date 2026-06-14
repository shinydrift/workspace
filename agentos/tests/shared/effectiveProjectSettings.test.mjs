import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../src/shared/effectiveProjectSettings.ts');

test('effective project settings merge app defaults before project overrides', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /const app = \{ \.\.\.DEFAULT_WORKTREE_SETTINGS, \.\.\.\(settings\.worktree \?\? \{\}\) \};/);
  assert.match(source, /settings\.containers\?\.pruneIdleHours \?\? DEFAULT_CONTAINER_PRUNE_SETTINGS\.idleHours/);
  assert.match(source, /settings\.containers\?\.pruneMaxAgeDays \?\? DEFAULT_CONTAINER_PRUNE_SETTINGS\.maxAgeDays/);
});
