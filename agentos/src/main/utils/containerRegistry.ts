import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { eventLogger } from './eventLog';

export type ContainerRegistryEntry = {
  containerName: string;
  threadId: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  image: string;
  configHash?: string;
};

type ContainerRegistryFile = {
  version: 1;
  entries: ContainerRegistryEntry[];
};

type LockMeta = {
  pid: number;
  hostname: string;
  ts: number;
};

const DEFAULT_REGISTRY: ContainerRegistryFile = {
  version: 1,
  entries: [],
};

const STALE_LOCK_MS = 30_000;
const RETRY_DELAY_BASE_MS = 25;
const RETRY_JITTER_MS = 10;
const MAX_ATTEMPTS = 200;

function resolveStateDir(): string {
  return path.join(os.homedir(), '.agentos', 'state');
}

function registryPath(): string {
  return path.join(resolveStateDir(), 'container-registry.json');
}

function lockPath(targetPath: string): string {
  return `${targetPath}.lock`;
}

async function tryAcquireLock(lockFile: string): Promise<boolean> {
  try {
    const meta: LockMeta = { pid: process.pid, hostname: os.hostname(), ts: Date.now() };
    const handle = await fs.open(lockFile, 'wx');
    await handle.writeFile(JSON.stringify(meta), 'utf8');
    await handle.close();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

async function isLockStale(lockFile: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(lockFile, 'utf8');
    const meta = JSON.parse(raw) as LockMeta;
    if (Date.now() - meta.ts > STALE_LOCK_MS) return true;
    // Check if the owner process is dead (same host only)
    if (meta.hostname === os.hostname()) {
      try {
        process.kill(meta.pid, 0);
        return false; // process exists
      } catch {
        return true; // process gone
      }
    }
    return false;
  } catch {
    // Unreadable or malformed lock — treat as stale after threshold
    try {
      const stat = await fs.stat(lockFile);
      return Date.now() - stat.mtimeMs > STALE_LOCK_MS;
    } catch {
      return true;
    }
  }
}

async function withRegistryLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = lockPath(targetPath);
  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (await tryAcquireLock(lockFile)) {
      try {
        return await fn();
      } finally {
        await fs.rm(lockFile, { force: true }).catch((err) => {
          eventLogger.warn('container-registry', 'failed to remove lock file', { error: String(err) });
        });
      }
    }

    if (await isLockStale(lockFile)) {
      eventLogger.warn('container-registry', 'removing stale lock file', { lockFile });
      await fs.rm(lockFile, { force: true }).catch(() => {});
      continue;
    }

    const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_BASE_MS + jitter));
  }

  throw new Error(`Failed to acquire registry lock after ${MAX_ATTEMPTS} attempts: ${lockFile}`);
}

async function readRegistryStrict(targetPath: string): Promise<ContainerRegistryFile> {
  const raw = await fs.readFile(targetPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid container registry format: ${targetPath}`);
  }
  const rec = parsed as { version?: unknown; entries?: unknown };
  if (rec.version !== 1 || !Array.isArray(rec.entries)) {
    throw new Error(`Invalid container registry format: ${targetPath}`);
  }
  return { version: 1, entries: rec.entries as ContainerRegistryEntry[] };
}

export async function readContainerRegistry(): Promise<ContainerRegistryFile> {
  const targetPath = registryPath();
  try {
    return await readRegistryStrict(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ...DEFAULT_REGISTRY };
    }
    // Corrupt file — back it up before resetting
    const corruptPath = `${targetPath}.corrupt-${Date.now()}`;
    eventLogger.warn('container-registry', 'corrupt registry file, backing up and resetting', {
      corruptPath,
      error: String(error),
    });
    await fs.rename(targetPath, corruptPath).catch(() => {});
    return { ...DEFAULT_REGISTRY };
  }
}

async function writeRegistry(targetPath: string, next: ContainerRegistryFile): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const payload = `${JSON.stringify(next, null, 2)}\n`;
  const tempPath = path.join(dir, `${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tempPath, payload, 'utf8');
  try {
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch((err) => {
      eventLogger.warn('container-registry', 'failed to remove temp file', { error: String(err) });
    });
    throw error;
  }
}

async function mutateRegistry(
  mutate: (entries: ContainerRegistryEntry[]) => ContainerRegistryEntry[] | null
): Promise<void> {
  const targetPath = registryPath();
  await withRegistryLock(targetPath, async () => {
    const current = await readContainerRegistry();
    const nextEntries = mutate(current.entries);
    if (nextEntries === null) {
      return;
    }
    await writeRegistry(targetPath, { version: 1, entries: nextEntries });
  });
}

export async function upsertContainerRegistryEntry(entry: ContainerRegistryEntry): Promise<void> {
  await mutateRegistry((entries) => {
    const existing = entries.find((item) => item.containerName === entry.containerName);
    const next = entries.filter((item) => item.containerName !== entry.containerName);
    next.push({
      ...entry,
      createdAtMs: existing?.createdAtMs ?? entry.createdAtMs,
      image: existing?.image ?? entry.image,
      configHash: entry.configHash ?? existing?.configHash,
    });
    return next;
  });
}

export async function touchContainerRegistryEntry(
  containerName: string,
  timestampMs: number = Date.now()
): Promise<void> {
  await mutateRegistry((entries) => {
    const idx = entries.findIndex((entry) => entry.containerName === containerName);
    if (idx < 0) {
      return null;
    }
    const next = [...entries];
    next[idx] = {
      ...next[idx],
      lastUsedAtMs: timestampMs,
    };
    return next;
  });
}

export async function removeContainerRegistryEntry(containerName: string): Promise<void> {
  await mutateRegistry((entries) => {
    const next = entries.filter((entry) => entry.containerName !== containerName);
    if (next.length === entries.length) {
      return null;
    }
    return next;
  });
}

export async function removeContainerRegistryEntriesForThread(threadId: string): Promise<void> {
  await mutateRegistry((entries) => {
    const next = entries.filter((entry) => entry.threadId !== threadId);
    if (next.length === entries.length) {
      return null;
    }
    return next;
  });
}

export async function findContainerRegistryEntry(containerName: string): Promise<ContainerRegistryEntry | null> {
  const registry = await readContainerRegistry();
  return registry.entries.find((entry) => entry.containerName === containerName) ?? null;
}
