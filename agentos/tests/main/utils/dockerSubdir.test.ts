/**
 * Tests for the monorepo subdir support in utils/docker/sandbox.ts — buildDockerRunArgs.
 *
 * The whole repo root is always mounted at /workspace; an optional `subdir` only shifts the
 * container's --workdir to /workspace/<subdir>. sandbox.ts transitively imports eventLog, which
 * pulls electron at module load — stub 'electron' before importing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';

// @ts-expect-error — private Node API
const originalLoad = Module._load;
// @ts-expect-error — Module._load signature is not in @types/node
Module._load = function (...args: [string, unknown, boolean]) {
  if (args[0] === 'electron') return { BrowserWindow: class {}, app: { getPath: () => '/tmp' } };
  // @ts-expect-error — forwarding rest args to private API
  return originalLoad.apply(this, args);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDockerRunArgs } = require('../../../src/main/utils/docker/sandbox');

// @ts-expect-error — restore private API
Module._load = originalLoad;

// A real on-disk repo root + subdir so the existence validation passes.
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-subdir-'));
fs.mkdirSync(path.join(repoRoot, 'apps', 'backend'), { recursive: true });

function workdirFlag(args: string[]): string {
  const i = args.indexOf('--workdir');
  return i >= 0 ? args[i + 1] : '';
}

function mountFlag(args: string[]): string {
  // First -v is the workspace bind mount.
  const i = args.indexOf('-v');
  return i >= 0 ? args[i + 1] : '';
}

test('mounts the repo root and sets workdir to /workspace/<subdir>', () => {
  const { args } = buildDockerRunArgs(
    'sess1',
    repoRoot,
    'img',
    'claude',
    undefined,
    undefined,
    [],
    [],
    {},
    {
      subdir: 'apps/backend',
    }
  );
  assert.equal(mountFlag(args), `${repoRoot}:/workspace`);
  assert.equal(workdirFlag(args), '/workspace/apps/backend');
});

test('defaults workdir to /workspace when no subdir', () => {
  const { args } = buildDockerRunArgs('sess1', repoRoot, 'img', 'claude', undefined);
  assert.equal(mountFlag(args), `${repoRoot}:/workspace`);
  assert.equal(workdirFlag(args), '/workspace');
});

test('throws when the subdir does not exist under the repo root', () => {
  assert.throws(
    () =>
      buildDockerRunArgs(
        'sess1',
        repoRoot,
        'img',
        'claude',
        undefined,
        undefined,
        [],
        [],
        {},
        {
          subdir: 'apps/missing',
        }
      ),
    /subdirectory does not exist/
  );
});

test('normalizes a messy but valid subdir', () => {
  const { args } = buildDockerRunArgs(
    'sess1',
    repoRoot,
    'img',
    'claude',
    undefined,
    undefined,
    [],
    [],
    {},
    {
      subdir: './apps//backend/',
    }
  );
  assert.equal(workdirFlag(args), '/workspace/apps/backend');
});

test('rejects a traversal subdir even though the resolved dir exists', () => {
  // `apps/../apps/backend` resolves to a real dir on disk, but the `..` must be rejected outright
  // so an un-normalized value can never set the workdir outside /workspace.
  assert.throws(
    () =>
      buildDockerRunArgs(
        'sess1',
        repoRoot,
        'img',
        'claude',
        undefined,
        undefined,
        [],
        [],
        {},
        {
          subdir: 'apps/../apps/backend',
        }
      ),
    /stay within the repo root/
  );
});
