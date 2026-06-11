/**
 * Tests for integrations/slackUploadWorkspace.ts — resolveSlackUploadWorkspace
 * and ensureSlackUploadsDir.
 *
 * Resolver is the single source of truth for upload_file's host-path translation:
 * it returns thread.workingDirectory (the actual /workspace mount source) or null.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  ensureSlackUploadsDir,
  resolveSlackUploadWorkspace,
  SLACK_UPLOADS_CONTAINER_PATH,
  SLACK_UPLOADS_RELATIVE,
  validateSlackUploadPath,
} from '../../../src/main/integrations/slackUploadWorkspace';

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

test('SLACK_UPLOADS_CONTAINER_PATH matches the relative path under /workspace', () => {
  assert.equal(SLACK_UPLOADS_CONTAINER_PATH, `/workspace/${SLACK_UPLOADS_RELATIVE}`);
});

test('ensureSlackUploadsDir creates the uploads directory under workingDirectory', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-uploads-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));

  const created = await ensureSlackUploadsDir(tmp);

  assert.equal(created, join(tmp, SLACK_UPLOADS_RELATIVE));
  const info = await stat(created);
  assert.ok(info.isDirectory(), 'expected uploads path to be a directory');
});

test('ensureSlackUploadsDir is idempotent (safe to call when the dir already exists)', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-uploads-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));

  await ensureSlackUploadsDir(tmp);
  // Should not throw on second call.
  const second = await ensureSlackUploadsDir(tmp);
  const info = await stat(second);
  assert.ok(info.isDirectory());
});

test('validateSlackUploadPath accepts a file under /workspace/.agentos/uploads/', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-validate-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const uploadsDir = await ensureSlackUploadsDir(tmp);
  const filePath = join(uploadsDir, 'foo.png');
  await writeFile(filePath, 'x');

  const resolved = await validateSlackUploadPath(`${SLACK_UPLOADS_CONTAINER_PATH}/foo.png`, tmp);
  assert.equal(resolved, await realpath(filePath));
});

test('validateSlackUploadPath rejects paths outside the uploads folder (wrong prefix)', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-validate-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await ensureSlackUploadsDir(tmp);

  await assert.rejects(() => validateSlackUploadPath('/workspace/dist/build.zip', tmp), /must be under/);
});

test('validateSlackUploadPath rejects `..` traversal that resolves outside uploads/ but inside workingDir', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-validate-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await ensureSlackUploadsDir(tmp);
  // path.join normalizes `.agentos/uploads/..` → `.agentos` BEFORE realpath runs, so the
  // file we want the attacker to land on must sit at `<tmp>/.agentos/sibling.txt` — one
  // level up from uploads/ but still under workingDir.
  await writeFile(join(tmp, '.agentos', 'sibling.txt'), 'x');

  // Sandbox prefix passes (literal startsWith); realpath resolves to <tmp>/.agentos/sibling.txt,
  // which sits inside workingDir but outside .agentos/uploads/. The realpath-containment
  // guard must reject it.
  await assert.rejects(
    () => validateSlackUploadPath(`${SLACK_UPLOADS_CONTAINER_PATH}/../sibling.txt`, tmp),
    /must resolve to a file under/
  );
});

test('validateSlackUploadPath rejects symlinks inside uploads/ that point outside the folder', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-validate-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const uploadsDir = await ensureSlackUploadsDir(tmp);
  const docsDir = join(tmp, 'docs');
  await mkdir(docsDir, { recursive: true });
  const target = join(docsDir, 'secret.txt');
  await writeFile(target, 'x');
  await symlink(target, join(uploadsDir, 'sneaky.txt'));

  await assert.rejects(
    () => validateSlackUploadPath(`${SLACK_UPLOADS_CONTAINER_PATH}/sneaky.txt`, tmp),
    /must resolve to a file under/
  );
});

test('validateSlackUploadPath rejects the uploads directory itself (no filename)', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'slack-validate-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await ensureSlackUploadsDir(tmp);

  // Exactly the directory path (no trailing /, no filename) does not satisfy the
  // `startsWith(`${SLACK_UPLOADS_CONTAINER_PATH}/`)` requirement.
  await assert.rejects(() => validateSlackUploadPath(SLACK_UPLOADS_CONTAINER_PATH, tmp), /must be under/);
});
