export const SANDBOX_IMAGE_REBUILD_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SANDBOX_IMAGE_INVALIDATION_ARG = 'SANDBOX_IMAGE_INVALIDATION_KEY';

export type SandboxImageRebuildReason = 'dockerfile_changed' | 'daily_interval_elapsed';

export function getSandboxImageInvalidationBuildArgs(now = Date.now()): Record<string, string> {
  return { [SANDBOX_IMAGE_INVALIDATION_ARG]: String(now) };
}

export function shouldForceSandboxImageRebuild(params: {
  sandboxHash: string;
  storedSandboxHash?: string;
  imageBuilt: boolean;
  lastBuiltAt?: number;
  now?: number;
}): { forceRebuild: boolean; reason?: SandboxImageRebuildReason } {
  const now = params.now ?? Date.now();

  if (params.storedSandboxHash !== undefined && params.storedSandboxHash !== params.sandboxHash) {
    return { forceRebuild: true, reason: 'dockerfile_changed' };
  }

  const stale = typeof params.lastBuiltAt !== 'number' || now - params.lastBuiltAt >= SANDBOX_IMAGE_REBUILD_INTERVAL_MS;
  if (params.imageBuilt && stale) {
    return { forceRebuild: true, reason: 'daily_interval_elapsed' };
  }

  return { forceRebuild: false };
}
