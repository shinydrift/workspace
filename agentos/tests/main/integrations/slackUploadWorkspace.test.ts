/**
 * Tests for integrations/slackUploadWorkspace.ts — resolveSlackUploadWorkspace.
 *
 * Resolver is the single source of truth for upload_file's host-path translation:
 * it returns thread.workingDirectory (the actual /workspace mount source) or null.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSlackUploadWorkspace } from '../../../src/main/integrations/slackUploadWorkspace';

test('returns thread.workingDirectory for a bound thread (worktree case)', () => {
  const worktreePath = '/Users/me/repo/.agentos/worktrees/feature-x';
  const result = resolveSlackUploadWorkspace({ threadId: 't1' }, (id) => (id === 't1' ? worktreePath : null));
  assert.equal(result, worktreePath);
});

test('returns null when binding has no threadId', () => {
  const result = resolveSlackUploadWorkspace({}, () => {
    throw new Error('lookup should not be called when threadId is absent');
  });
  assert.equal(result, null);
});

test('returns null when thread lookup returns null (dangling binding)', () => {
  const result = resolveSlackUploadWorkspace({ threadId: 'missing' }, () => null);
  assert.equal(result, null);
});

test('returns null when binding is null', () => {
  assert.equal(
    resolveSlackUploadWorkspace(null, () => '/should/not/matter'),
    null
  );
});
