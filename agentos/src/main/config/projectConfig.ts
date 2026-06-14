import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import {
  normalizeProviderOrder,
  type BigFiveTraits,
  type PersonalitySettings,
  type ProjectConfig,
} from '../../shared/types';

export const PROJECT_CONFIG_KEYS = [
  'version',
  'runOnHost',
  'sandbox',
  'kanban',
  'memory',
  'worktree',
  'env',
  'apiKeys',
  'tailscale',
  'agents',
  'containers',
  'personality',
  'recording',
] as const;

const ALLOWED_TOP_LEVEL_KEYS = new Set<string>(PROJECT_CONFIG_KEYS);
const LEGACY_IGNORED_KEYS = new Set<string>(['failover']);

const ALLOWED_SANDBOX_NETWORK = new Set(['none', 'bridge', 'host']);

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

  const { config, warnings } = validateProjectConfig(parsed);
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
    const config = validateProjectConfig(raw).config;
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

function validateProjectConfig(raw: unknown): { config: ProjectConfig; warnings: string[] } {
  const warnings: string[] = [];
  const config: ProjectConfig = {};

  if (!isRecord(raw)) {
    warnings.push('Expected top-level object');
    return { config, warnings };
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key) && !LEGACY_IGNORED_KEYS.has(key)) {
      warnings.push(`Unknown top-level key "${key}" ignored`);
    }
  }

  const pickBool = (src: Record<string, unknown>, dest: Record<string, unknown>, key: string, label: string) => {
    if (!(key in src)) return;
    if (typeof src[key] === 'boolean') dest[key] = src[key];
    else warnings.push(`Invalid "${label}" ignored`);
  };

  const pickNum = (src: Record<string, unknown>, dest: Record<string, unknown>, key: string, label: string) => {
    if (!(key in src)) return;
    if (typeof src[key] === 'number' && Number.isFinite(src[key])) dest[key] = src[key];
    else warnings.push(`Invalid "${label}" ignored`);
  };

  const pickNumInRange = (
    src: Record<string, unknown>,
    dest: Record<string, unknown>,
    key: string,
    label: string,
    min: number,
    max: number
  ) => {
    if (!(key in src)) return;
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) dest[key] = v;
    else warnings.push(`Invalid "${label}" ignored (must be ${min}–${max})`);
  };

  const pickStr = (src: Record<string, unknown>, dest: Record<string, unknown>, key: string, label: string) => {
    if (!(key in src)) return;
    if (typeof src[key] === 'string') dest[key] = src[key];
    else warnings.push(`Invalid "${label}" ignored`);
  };

  if ('version' in raw) {
    if (raw.version === 1) config.version = 1;
    else warnings.push('Invalid "version" ignored');
  }

  pickBool(raw, config as Record<string, unknown>, 'runOnHost', 'runOnHost');

  if ('sandbox' in raw) {
    if (isRecord(raw.sandbox)) {
      const sandbox: ProjectConfig['sandbox'] = {};
      pickBool(raw.sandbox, sandbox, 'readOnlyRoot', 'sandbox.readOnlyRoot');
      pickBool(raw.sandbox, sandbox, 'dropAllCapabilities', 'sandbox.dropAllCapabilities');
      pickBool(raw.sandbox, sandbox, 'noNewPrivileges', 'sandbox.noNewPrivileges');
      if ('network' in raw.sandbox) {
        if (typeof raw.sandbox.network === 'string' && ALLOWED_SANDBOX_NETWORK.has(raw.sandbox.network)) {
          sandbox.network = raw.sandbox.network as 'none' | 'bridge' | 'host';
        } else {
          warnings.push('Invalid "sandbox.network" ignored');
        }
      }
      if ('memory' in raw.sandbox && typeof raw.sandbox.memory === 'string') sandbox.memory = raw.sandbox.memory;
      if ('cpus' in raw.sandbox && typeof raw.sandbox.cpus === 'string') sandbox.cpus = raw.sandbox.cpus;
      if ('tmpfs' in raw.sandbox && Array.isArray(raw.sandbox.tmpfs)) {
        sandbox.tmpfs = raw.sandbox.tmpfs.filter((entry): entry is string => typeof entry === 'string');
      }
      config.sandbox = sandbox;
    } else {
      warnings.push('Invalid "sandbox" ignored');
    }
  }

  if ('kanban' in raw) {
    if (isRecord(raw.kanban)) {
      const kanban: NonNullable<ProjectConfig['kanban']> = {};
      pickBool(raw.kanban, kanban, 'enabled', 'kanban.enabled');
      if ('stages' in raw.kanban && isRecord(raw.kanban.stages)) {
        const stages: NonNullable<NonNullable<ProjectConfig['kanban']>['stages']> = {};
        for (const [stageId, entry] of Object.entries(raw.kanban.stages)) {
          if (!isRecord(entry)) {
            warnings.push(`Invalid "kanban.stages.${stageId}" ignored`);
            continue;
          }
          const stage: { prompt?: string } = {};
          if ('prompt' in entry && typeof entry.prompt === 'string') {
            stage.prompt = entry.prompt;
          }
          stages[stageId] = stage;
        }
        kanban.stages = stages;
      }
      config.kanban = kanban;
    } else {
      warnings.push('Invalid "kanban" ignored');
    }
  }

  if ('memory' in raw) {
    if (isRecord(raw.memory)) {
      const mem: NonNullable<ProjectConfig['memory']> = {};
      pickBool(raw.memory, mem, 'enabled', 'memory.enabled');
      pickBool(raw.memory, mem, 'decayEnabled', 'memory.decayEnabled');
      pickBool(raw.memory, mem, 'graphEnabled', 'memory.graphEnabled');
      pickNum(raw.memory, mem, 'decayHalfLifeDays', 'memory.decayHalfLifeDays');
      pickNum(raw.memory, mem, 'decayMinScore', 'memory.decayMinScore');
      pickNum(raw.memory, mem, 'graphBoost', 'memory.graphBoost');
      pickNumInRange(raw.memory, mem, 'maxResults', 'memory.maxResults', 1, 100);
      pickNumInRange(raw.memory, mem, 'minScore', 'memory.minScore', 0, 1);
      pickNumInRange(raw.memory, mem, 'vectorWeight', 'memory.vectorWeight', 0, 1);
      pickNumInRange(raw.memory, mem, 'textWeight', 'memory.textWeight', 0, 1);
      pickNumInRange(raw.memory, mem, 'mmrLambda', 'memory.mmrLambda', 0, 1);
      pickNumInRange(raw.memory, mem, 'sessionRetentionDays', 'memory.sessionRetentionDays', 0, 3650);
      pickNumInRange(raw.memory, mem, 'codeVectorWeight', 'memory.codeVectorWeight', 0, 1);
      pickNumInRange(raw.memory, mem, 'codeTextWeight', 'memory.codeTextWeight', 0, 1);
      pickNumInRange(raw.memory, mem, 'codeDecayHalfLifeDays', 'memory.codeDecayHalfLifeDays', 0, 3650);
      if ('extraPaths' in raw.memory && Array.isArray(raw.memory.extraPaths)) {
        mem.extraPaths = raw.memory.extraPaths.filter((e): e is string => typeof e === 'string');
      }
      config.memory = mem;
    } else {
      warnings.push('Invalid "memory" ignored');
    }
  }

  if ('worktree' in raw) {
    if (isRecord(raw.worktree)) {
      const worktree: NonNullable<ProjectConfig['worktree']> = {};
      pickBool(raw.worktree, worktree, 'autoCreate', 'worktree.autoCreate');
      pickBool(raw.worktree, worktree, 'pruneOnStop', 'worktree.pruneOnStop');
      config.worktree = worktree;
    } else {
      warnings.push('Invalid "worktree" ignored');
    }
  }

  if ('env' in raw) {
    if (isRecord(raw.env)) {
      const env: NonNullable<ProjectConfig['env']> = {};
      if ('safelist' in raw.env && Array.isArray(raw.env.safelist)) {
        env.safelist = raw.env.safelist.filter((entry): entry is string => typeof entry === 'string');
      }
      if ('vars' in raw.env && isRecord(raw.env.vars)) {
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw.env.vars)) {
          if (typeof k === 'string' && typeof v === 'string') vars[k] = v;
        }
        env.vars = vars;
      }
      config.env = env;
    } else {
      warnings.push('Invalid "env" ignored');
    }
  }

  if ('apiKeys' in raw) {
    if (isRecord(raw.apiKeys)) {
      const apiKeys: NonNullable<ProjectConfig['apiKeys']> = {};
      const stringKeys = ['anthropic', 'openai', 'google', 'openrouter', 'voyage', 'mistral', 'github'] as const;
      for (const k of stringKeys) {
        if (k in raw.apiKeys && typeof raw.apiKeys[k] === 'string') {
          apiKeys[k] = raw.apiKeys[k] as string;
        }
      }
      // Tailscale moved out of apiKeys into its own `tailscale` block — warn rather than drop silently.
      if ('tailscaleAuthKey' in raw.apiKeys || 'tailscaleFunnel' in raw.apiKeys) {
        warnings.push(
          '"apiKeys.tailscaleAuthKey"/"apiKeys.tailscaleFunnel" moved to the "tailscale" block — ignored here'
        );
      }
      config.apiKeys = apiKeys;
    } else {
      warnings.push('Invalid "apiKeys" ignored');
    }
  }

  if ('tailscale' in raw) {
    if (isRecord(raw.tailscale)) {
      const tailscale: NonNullable<ProjectConfig['tailscale']> = {};
      pickStr(raw.tailscale, tailscale, 'authKey', 'tailscale.authKey');
      pickBool(raw.tailscale, tailscale, 'funnel', 'tailscale.funnel');
      config.tailscale = tailscale;
    } else {
      warnings.push('Invalid "tailscale" ignored');
    }
  }

  if ('agents' in raw) {
    if (isRecord(raw.agents)) {
      const agents: NonNullable<ProjectConfig['agents']> = {};
      if ('providerOrder' in raw.agents && Array.isArray(raw.agents.providerOrder)) {
        const valid = normalizeProviderOrder(raw.agents.providerOrder);
        if (valid.length > 0) agents.providerOrder = valid;
      }
      pickNum(raw.agents, agents, 'queueSilenceFallbackMs', 'agents.queueSilenceFallbackMs');
      if ('autopilot' in raw.agents && isRecord(raw.agents.autopilot)) {
        const autopilot: NonNullable<NonNullable<ProjectConfig['agents']>['autopilot']> = {};
        pickNum(raw.agents.autopilot, autopilot, 'maxConsecutiveTurns', 'agents.autopilot.maxConsecutiveTurns');
        pickNum(raw.agents.autopilot, autopilot, 'transcriptMessages', 'agents.autopilot.transcriptMessages');
        agents.autopilot = autopilot;
      }
      config.agents = agents;
    } else {
      warnings.push('Invalid "agents" ignored');
    }
  }

  if ('containers' in raw) {
    if (isRecord(raw.containers)) {
      const containers: NonNullable<ProjectConfig['containers']> = {};
      pickNum(raw.containers, containers, 'pruneIdleHours', 'containers.pruneIdleHours');
      pickNum(raw.containers, containers, 'pruneMaxAgeDays', 'containers.pruneMaxAgeDays');
      config.containers = containers;
    } else {
      warnings.push('Invalid "containers" ignored');
    }
  }

  if ('personality' in raw) {
    if (isRecord(raw.personality)) {
      const p: Record<string, unknown> = { agentStyle: '', autopilotInstructions: '' };
      // Migrate legacy 'profile' field to 'agentStyle'
      if ('agentStyle' in raw.personality && typeof raw.personality.agentStyle === 'string') {
        p.agentStyle = raw.personality.agentStyle;
      } else if ('profile' in raw.personality && typeof raw.personality.profile === 'string') {
        p.agentStyle = raw.personality.profile;
      }
      pickStr(raw.personality, p, 'autopilotInstructions', 'personality.autopilotInstructions');
      if ('activePresetId' in raw.personality && typeof raw.personality.activePresetId === 'string') {
        p.activePresetId = raw.personality.activePresetId;
      }
      if ('bigFive' in raw.personality && isRecord(raw.personality.bigFive)) {
        const bf = raw.personality.bigFive;
        const traitKeys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
        const traits: Record<string, unknown> = {};
        for (const k of traitKeys) {
          if (k in bf && typeof bf[k] === 'number' && Number.isFinite(bf[k])) traits[k] = bf[k];
        }
        if (traitKeys.every((k) => k in traits)) {
          p.bigFive = traits as unknown as BigFiveTraits;
        }
      }
      pickNum(raw.personality, p, 'generatedAt', 'personality.generatedAt');
      pickNum(raw.personality, p, 'messageCount', 'personality.messageCount');
      if ('history' in raw.personality && Array.isArray(raw.personality.history)) {
        const traitKeys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
        p.history = raw.personality.history
          .filter((h): h is Record<string, unknown> => isRecord(h) && typeof h.generatedAt === 'number')
          .map((h) => {
            const snap: Record<string, unknown> = {
              agentStyle: typeof h.agentStyle === 'string' ? h.agentStyle : '',
              autopilotInstructions: typeof h.autopilotInstructions === 'string' ? h.autopilotInstructions : '',
              generatedAt: h.generatedAt,
            };
            if (typeof h.messageCount === 'number') snap.messageCount = h.messageCount;
            if (isRecord(h.bigFive)) {
              const traits: Record<string, unknown> = {};
              for (const k of traitKeys) {
                if (k in h.bigFive && typeof h.bigFive[k] === 'number') traits[k] = h.bigFive[k];
              }
              if (traitKeys.every((k) => k in traits)) snap.bigFive = traits;
            }
            return snap;
          })
          .slice(0, 3);
      }
      // Legacy compat: explicit enabled:false means the user disabled personality.
      // Presence of the object is now the enabled signal, so skip assignment.
      if (!('enabled' in raw.personality && raw.personality.enabled === false)) {
        config.personality = p as unknown as PersonalitySettings;
      }
    } else {
      warnings.push('Invalid "personality" ignored');
    }
  }

  if ('recording' in raw) {
    if (isRecord(raw.recording)) {
      const recording: NonNullable<ProjectConfig['recording']> = {};
      if ('activeTemplateId' in raw.recording && typeof raw.recording.activeTemplateId === 'string') {
        recording.activeTemplateId = raw.recording.activeTemplateId;
      }
      if ('templates' in raw.recording && Array.isArray(raw.recording.templates)) {
        const templates: NonNullable<NonNullable<ProjectConfig['recording']>['templates']> = [];
        for (const entry of raw.recording.templates as unknown[]) {
          if (
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            entry.id.length > 0 &&
            typeof entry.name === 'string' &&
            typeof entry.content === 'string'
          ) {
            templates.push({ id: entry.id, name: entry.name, content: entry.content });
          }
        }
        if (templates.length > 0) recording.templates = templates;
      }
      config.recording = recording;
    } else {
      warnings.push('Invalid "recording" ignored');
    }
  }

  return { config, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
