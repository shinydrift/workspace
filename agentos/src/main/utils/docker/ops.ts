import crypto from 'crypto';
import type { Provider } from '../../../shared/types';
import { findContainerRegistryEntry, removeContainerRegistryEntry } from '../containerRegistry';
import { inspectContainer, removeContainer as removeDockerContainer } from '../dockerCleanup';
import { eventLogger } from '../eventLog';

export type ContainerConfigHashParams = {
  threadId: string;
  workingDirectory: string;
  imageName: string;
  provider: Provider;
  sandbox: unknown;
  providerArgs: string[];
  extraReadonlyMounts: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  dockerfileHash?: string | null;
};

export function computeContainerConfigHash(params: ContainerConfigHashParams): string {
  const hashInput = JSON.stringify({
    threadId: params.threadId,
    workingDirectory: params.workingDirectory,
    imageName: params.imageName,
    provider: params.provider,
    sandbox: params.sandbox ?? {},
    providerArgs: params.providerArgs,
    extraReadonlyMounts: params.extraReadonlyMounts,
    dockerfileHash: params.dockerfileHash ?? null,
  });
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

export function shouldPruneContainer(
  entry: { lastUsedAtMs: number; createdAtMs: number },
  now: number,
  idleHours: number,
  maxAgeDays: number
): boolean {
  const idleMs = now - entry.lastUsedAtMs;
  const ageMs = now - entry.createdAtMs;
  return (
    (idleHours > 0 && idleMs > idleHours * 60 * 60 * 1000) ||
    (maxAgeDays > 0 && ageMs > maxAgeDays * 24 * 60 * 60 * 1000)
  );
}

/**
 * If an existing container is found for this thread, removes it and its registry entry.
 * Returns true if a container was found (caller should clear persisted session IDs).
 */
export async function handleExistingContainerForStart(params: {
  threadId: string;
  containerName: string;
  expectedConfigHash: string;
}): Promise<boolean> {
  const state = await inspectContainer(params.containerName);
  if (!state.exists) {
    return false;
  }

  const now = Date.now();
  const registryEntry = await findContainerRegistryEntry(params.containerName);
  const currentHash = state.labels['agentos.configHash'] ?? registryEntry?.configHash ?? null;
  const hashMismatch = !currentHash || currentHash !== params.expectedConfigHash;
  const isHot = state.running && (!registryEntry || now - registryEntry.lastUsedAtMs < 5 * 60 * 1000);

  const logFn = hashMismatch ? eventLogger.warn.bind(eventLogger) : eventLogger.info.bind(eventLogger);
  logFn('docker', 'Removing existing container before start', {
    threadId: params.threadId,
    containerName: params.containerName,
    wasRunning: state.running,
    hashMismatch,
    ...(hashMismatch ? { currentHash, expectedHash: params.expectedConfigHash, hot: isHot } : {}),
  });

  await removeDockerContainer(params.containerName).catch((err) => {
    eventLogger.warn('container-ops', 'failed to remove docker container', { error: String(err) });
  });
  await removeContainerRegistryEntry(params.containerName).catch((err) => {
    eventLogger.warn('container-ops', 'failed to remove registry entry', { error: String(err) });
  });
  return true;
}
