import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSandboxImageInvalidationBuildArgs,
  SANDBOX_IMAGE_INVALIDATION_ARG,
  SANDBOX_IMAGE_REBUILD_INTERVAL_MS,
  shouldForceSandboxImageRebuild,
} from '../../../src/main/utils/docker/imageInvalidation';

test('shouldForceSandboxImageRebuild: rebuilds when Dockerfile hash changed', () => {
  assert.deepEqual(
    shouldForceSandboxImageRebuild({
      sandboxHash: 'new-hash',
      storedSandboxHash: 'old-hash',
      imageBuilt: true,
      lastBuiltAt: 100,
      now: 101,
    }),
    { forceRebuild: true, reason: 'dockerfile_changed' }
  );
});

test('shouldForceSandboxImageRebuild: rebuilds existing image when no build timestamp is stored', () => {
  assert.deepEqual(
    shouldForceSandboxImageRebuild({
      sandboxHash: 'same-hash',
      storedSandboxHash: 'same-hash',
      imageBuilt: true,
      now: 1_000,
    }),
    { forceRebuild: true, reason: 'daily_interval_elapsed' }
  );
});

test('shouldForceSandboxImageRebuild: rebuilds existing image after 24 hours', () => {
  const now = 10_000 + SANDBOX_IMAGE_REBUILD_INTERVAL_MS;
  assert.deepEqual(
    shouldForceSandboxImageRebuild({
      sandboxHash: 'same-hash',
      storedSandboxHash: 'same-hash',
      imageBuilt: true,
      lastBuiltAt: 10_000,
      now,
    }),
    { forceRebuild: true, reason: 'daily_interval_elapsed' }
  );
});

test('shouldForceSandboxImageRebuild: skips existing image before 24 hours', () => {
  const now = 10_000 + SANDBOX_IMAGE_REBUILD_INTERVAL_MS - 1;
  assert.deepEqual(
    shouldForceSandboxImageRebuild({
      sandboxHash: 'same-hash',
      storedSandboxHash: 'same-hash',
      imageBuilt: true,
      lastBuiltAt: 10_000,
      now,
    }),
    { forceRebuild: false }
  );
});

test('shouldForceSandboxImageRebuild: does not force when image is missing', () => {
  assert.deepEqual(
    shouldForceSandboxImageRebuild({
      sandboxHash: 'same-hash',
      storedSandboxHash: 'same-hash',
      imageBuilt: false,
      now: 1_000,
    }),
    { forceRebuild: false }
  );
});

test('getSandboxImageInvalidationBuildArgs: returns stable Docker build arg shape', () => {
  assert.deepEqual(getSandboxImageInvalidationBuildArgs(12345), {
    [SANDBOX_IMAGE_INVALIDATION_ARG]: '12345',
  });
});
