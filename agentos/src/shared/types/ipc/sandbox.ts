export const SANDBOX_IPC_CHANNELS = {
  SANDBOX_CHECK_DOCKER: 'sandbox:checkDocker',
  SANDBOX_OPEN_DOCKER: 'sandbox:openDocker',
  SANDBOX_LIST_CONTAINERS: 'sandbox:listContainers',
  SANDBOX_PRUNE_CONTAINERS: 'sandbox:pruneContainers',
  SANDBOX_REMOVE_CONTAINER: 'sandbox:removeContainer',
} as const;

export interface ContainerSummary {
  containerName: string;
  threadId: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  image: string;
  running: boolean;
  exists: boolean;
  imageMatch: boolean;
  currentConfigHash: string | null;
  expectedConfigHash: string | null;
  drift: boolean;
  orphaned: boolean;
}

export interface DockerCheckResult {
  available: boolean;
  imageBuilt: boolean;
}
