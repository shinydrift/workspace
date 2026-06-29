import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import type { ProjectConfig } from '../../shared/types';
import { parseProjectConfig } from '../../shared/config/schema';

// Re-exported from the canonical schema (single source of truth) so the IPC handler
// can keep importing it from here.
export { PROJECT_CONFIG_KEYS } from '../../shared/config/schema';

const MAX_CONFIG_BYTES = 1024 * 1024; // 1 MiB

export type ProjectConfigLoadResult = {
  config: ProjectConfig | null;
  path: string;
  exists: boolean;
  warnings: string[];
};

// Per-path promise-chain mutex — serializes all read-modify-write cycles per config file.
const _writeLocks = new Map<string, Promise<unknown>>();
function withConfigLock<T>(cfgPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = _writeLocks.get(cfgPath) ?? Promise.resolve();
  const current = prev.then(
    () => fn(),
    () => fn()
  );
  const sentinel = current.then<undefined, undefined>(
    () => undefined,
    () => undefined
  );
  _writeLocks.set(cfgPath, sentinel);
  sentinel.then(() => {
    if (_writeLocks.get(cfgPath) === sentinel) _writeLocks.delete(cfgPath);
  });
  return current;
}

// Sync cache keyed by absolute config path, invalidated by mtime so external edits are detected.
type CacheEntry = { mtimeMs: number; config: ProjectConfig | null };
const _syncConfigCache = new Map<string, CacheEntry>();

export function getProjectConfigPath(projectPath: string): string {
  return path.join(path.resolve(projectPath), '.agentos', 'config.json');
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfigLoadResult> {
  const configPath = getProjectConfigPath(projectPath);
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if (isEnoent(err)) return { config: null, path: configPath, exists: false, warnings: [] };
    return { config: null, path: configPath, exists: true, warnings: [`Cannot read config: ${errMsg(err)}`] };
  }

  if (raw.length > MAX_CONFIG_BYTES) {
    return {
      config: null,
      path: configPath,
      exists: true,
      warnings: [`Config file too large (${raw.length} bytes), ignoring`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { config: null, path: configPath, exists: true, warnings: ['Invalid JSON'] };
  }

  const { config, warnings } = parseProjectConfig(parsed);
  return { config, path: configPath, exists: true, warnings };
}

// Synchronous variant used in hot paths (e.g. resolveScope) where async is not possible.
// Invalidated by mtime: detects external edits (e.g. user opens config in editor via PROJECT_OPEN_CONFIG).
export function loadProjectConfigSync(projectPath: string): ProjectConfig | null {
  const configPath = getProjectConfigPath(projectPath);
  try {
    const stat = fsSync.statSync(configPath);
    const cached = _syncConfigCache.get(configPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.config;
    if (stat.size > MAX_CONFIG_BYTES) {
      _syncConfigCache.set(configPath, { mtimeMs: stat.mtimeMs, config: null });
      return null;
    }
    const raw = JSON.parse(fsSync.readFileSync(configPath, 'utf8')) as unknown;
    const config = parseProjectConfig(raw).config;
    _syncConfigCache.set(configPath, { mtimeMs: stat.mtimeMs, config });
    return config;
  } catch (err) {
    if (isEnoent(err)) {
      _syncConfigCache.delete(configPath);
      return null;
    }
    // Non-ENOENT (permission error, etc.): don't cache so the next call retries.
    return null;
  }
}

// Read the raw project config JSON, merge a partial update into a top-level key, and write it back.
// Creates the config file (and parent directories) if it doesn't exist.
// Serialized per config path and written atomically (temp-file + rename) to prevent lost updates and torn writes.
export async function updateProjectConfig(
  projectPath: string,
  key: keyof ProjectConfig,
  updates: Record<string, unknown>
): Promise<void> {
  const cfgPath = getProjectConfigPath(projectPath);
  return withConfigLock(cfgPath, async () => {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
    // Special sentinel: { _value: x } sets the field directly as a scalar (or null to delete).
    if ('_value' in updates) {
      if (updates['_value'] == null) {
        delete existing[key];
      } else {
        existing[key] = updates['_value'];
      }
    } else {
      existing[key] = { ...(existing[key] as Record<string, unknown> | undefined), ...updates };
    }
    await fs.mkdir(path.dirname(cfgPath), { recursive: true });
    await atomicWriteJson(cfgPath, existing);
    _syncConfigCache.delete(cfgPath);
  });
}

export async function ensureProjectConfig(
  projectPath: string
): Promise<{ created: boolean; lookup: ProjectConfigLoadResult }> {
  const cfgPath = getProjectConfigPath(projectPath);
  return withConfigLock(cfgPath, async () => {
    try {
      await fs.mkdir(path.dirname(cfgPath), { recursive: true });
      await fs.writeFile(cfgPath, `${JSON.stringify(defaultProjectConfigTemplate(), null, 2)}\n`, {
        flag: 'wx',
        encoding: 'utf8',
      });
      _syncConfigCache.delete(cfgPath);
      const lookup = await loadProjectConfig(projectPath);
      return { created: true, lookup };
    } catch (err) {
      if (!isEexist(err)) throw err;
      // Another concurrent caller already created it — just load.
      const lookup = await loadProjectConfig(projectPath);
      return { created: false, lookup };
    }
  });
}

// Writes data to a temp file in the same directory then renames over targetPath — crash-safe on POSIX.
async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  const tmp = `${targetPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, targetPath);
  } catch (err) {
    await fs.unlink(tmp).catch((): undefined => undefined);
    throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function isEexist(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'EEXIST';
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function resetProjectConfigCacheForTest(): void {
  _syncConfigCache.clear();
  _writeLocks.clear();
}

function defaultProjectConfigTemplate(): ProjectConfig {
  return {
    version: 1,
    worktree: { autoCreate: false },
    sandbox: {
      network: 'bridge',
    },
    memory: { enabled: true },
  };
}
