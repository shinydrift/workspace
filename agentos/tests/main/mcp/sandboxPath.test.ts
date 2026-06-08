/**
 * Tests for mcp/sandboxPath.ts — translateContainerPath.
 *
 * Covers: container-to-host translation, root path, traversal rejection,
 * symlink escapes, missing files, sanitized errors when the host workingDir is gone,
 * custom containerMount, and per-test cleanup of temp dirs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { translateContainerPath } from '../../../src/main/mcp/sandboxPath';

function mkTempDir(prefix: string, t: { after: (fn: () => void) => void }): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('translateContainerPath: maps /workspace/foo to <root>/foo', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  fs.writeFileSync(path.join(root, 'foo.txt'), 'hi');
  const resolved = translateContainerPath('/workspace/foo.txt', root);
  assert.equal(resolved, path.join(root, 'foo.txt'));
});

test('translateContainerPath: maps /workspace itself to the host root', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  const resolved = translateContainerPath('/workspace', root);
  assert.equal(resolved, root);
});

test('translateContainerPath: maps nested .agentos/uploads path', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  const dir = path.join(root, '.agentos', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.png'), 'x');
  const resolved = translateContainerPath('/workspace/.agentos/uploads/out.png', root);
  assert.equal(resolved, path.join(dir, 'out.png'));
});

test('translateContainerPath: rejects paths outside /workspace', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  assert.throws(() => translateContainerPath('/etc/passwd', root), /under \/workspace/);
  assert.throws(() => translateContainerPath('/tmp/foo', root), /under \/workspace/);
});

test('translateContainerPath: throws File not found for missing entry', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  assert.throws(() => translateContainerPath('/workspace/nope.txt', root), /File not found/);
});

test('translateContainerPath: rejects symlink escape outside workspace', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  const outside = mkTempDir('sandbox-path-outside-', t);
  const target = path.join(outside, 'secret.txt');
  fs.writeFileSync(target, 'shh');
  fs.symlinkSync(target, path.join(root, 'leak'));
  assert.throws(() => translateContainerPath('/workspace/leak', root), /under \/workspace/);
});

test('translateContainerPath: rejects ../ traversal even when target exists', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  fs.writeFileSync(path.join(path.dirname(root), 'sibling.txt'), 'oops');
  assert.throws(
    () => translateContainerPath(`/workspace/../${path.basename(root)}/../sibling.txt`, root),
    /under \/workspace/
  );
});

test('translateContainerPath: sanitizes errors when host workingDir is gone (no host path leak)', () => {
  const ghost = path.join(os.tmpdir(), 'sandbox-path-ghost-does-not-exist-xyz');
  try {
    translateContainerPath('/workspace/foo.txt', ghost);
    assert.fail('expected throw');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /Workspace directory unavailable/);
    assert.equal(msg.includes(ghost), false, 'host path must not leak in error');
  }
});

test('translateContainerPath: supports custom containerMount for non-/workspace tools', (t) => {
  const root = mkTempDir('sandbox-path-', t);
  fs.writeFileSync(path.join(root, 'data.bin'), 'x');
  const resolved = translateContainerPath('/sandbox/data.bin', root, '/sandbox');
  assert.equal(resolved, path.join(root, 'data.bin'));
  assert.throws(() => translateContainerPath('/workspace/data.bin', root, '/sandbox'), /under \/sandbox/);
});
