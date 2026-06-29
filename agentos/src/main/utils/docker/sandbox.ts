import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ClaudeEffort, CodexReasoning, Provider, SandboxSecuritySettings } from '../../../shared/types';
import { DEFAULT_SANDBOX_SETTINGS } from '../../../shared/types';
import { PROVIDER_CONFIGS, resolveProviderCommand } from '../providerConfig';
import { CLAUDE_CODE_OAUTH_TOKEN_ENV } from '../../sessions/threadAuth';
import { eventLogger } from '../eventLog';
import { AGENTOS_MCP_BEARER_TOKEN_ENV_VAR, getMcpAuthHeaders } from '../../mcp/mcpAuth';
import { normalizeSubdir } from '../../../shared/utils/subdir';

const execFileAsync = promisify(execFile);

export interface DockerArgs {
  command: string;
  args: string[];
  /**
   * Set only for host execution (`runOnHost`). Env that Docker would otherwise bake into the
   * container via `-e` flags; the caller overlays it onto the spawned process's env. Undefined
   * for the Docker path, where env travels as `-e` flags inside `args`.
   */
  env?: Record<string, string>;
}

function validateBindMount(hostPath: string, containerPath: string): void {
  if (!path.isAbsolute(hostPath)) throw new Error(`Bind mount host path must be absolute: ${hostPath}`);
  if (!path.isAbsolute(containerPath)) throw new Error(`Bind mount container path must be absolute: ${containerPath}`);
  // On macOS Docker Desktop, mounting a non-existent host path silently creates a
  // phantom directory that satisfies `docker run` but breaks every subsequent
  // `docker exec` with "current working directory is outside of container mount
  // namespace root". Fail loudly here so the caller (worktree creation, auth seeding)
  // fixes the source path instead of leaking a broken container.
  if (!fs.existsSync(hostPath)) {
    throw new Error(`Bind mount host path does not exist: ${hostPath} (would mount at ${containerPath})`);
  }
}

/**
 * Resolve the container working directory for a (mount, subdir) pair. The repo root is mounted
 * at /workspace; an optional subdir shifts the workdir to /workspace/<subdir>. Validates the
 * subdir actually exists on the host under the mount so the container doesn't start in a
 * non-existent dir (which would wedge every turn).
 */
function resolveContainerWorkdir(workingDir: string, subdir: string | undefined): string {
  // Normalize defensively (rejects `..`/absolute escapes) even though the runtime caller passes an
  // already-normalized snapshot — buildDockerRunArgs is exported and must not honor a raw `..`.
  const norm = normalizeSubdir(subdir);
  if (!norm) return '/workspace';
  const hostPath = path.join(workingDir, norm);
  if (!fs.existsSync(hostPath)) {
    throw new Error(`Project subdirectory does not exist under the repo root: ${hostPath}`);
  }
  return path.posix.join('/workspace', norm);
}

export function buildDockerRunArgs(
  sessionId: string,
  workingDir: string,
  imageName: string,
  provider: Provider,
  apiKey: string | undefined,
  security?: Partial<SandboxSecuritySettings>,
  providerArgs: string[] = [],
  extraReadonlyMounts: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }> = [],
  labels: Record<string, string> = {},
  opts: {
    headless?: boolean;
    claudeOauthToken?: string | null;
    sessionDataDir?: string;
    extraEnv?: Record<string, string>;
    seccompProfilePath?: string;
    providerCommandOverrides?: Partial<Record<Provider, string>>;
    /** Repo-root-relative working dir within the mount. The whole repo is still mounted at
     * /workspace; the container's workdir becomes /workspace/<subdir>. */
    subdir?: string;
  } = {}
): DockerArgs {
  validateBindMount(workingDir, '/workspace');
  const containerWorkdir = resolveContainerWorkdir(workingDir, opts.subdir);

  const cfg = PROVIDER_CONFIGS[provider];
  const sec: SandboxSecuritySettings = { ...DEFAULT_SANDBOX_SETTINGS, ...security };

  const args: string[] = [
    'run',
    '--rm',
    '-it',
    '--name',
    `agentos-session-${sessionId}`,
    '-v',
    `${workingDir}:/workspace`,
    '--workdir',
    containerWorkdir,

    // Read-only root + tmpfs
    ...(sec.readOnlyRoot ? ['--read-only'] : []),
    ...sec.tmpfs.flatMap((t) => ['--tmpfs', t]),

    // Capabilities
    ...(sec.dropAllCapabilities ? ['--cap-drop', 'ALL'] : []),
    ...(sec.noNewPrivileges ? ['--security-opt', 'no-new-privileges'] : []),
    ...(opts.seccompProfilePath ? ['--security-opt', `seccomp=${opts.seccompProfilePath}`] : []),
    '--user',
    'agent',

    // Network
    '--network',
    sec.network,

    // Resource limits
    ...(sec.memory ? ['--memory', sec.memory, '--memory-swap', sec.memory] : []),
    ...(sec.cpus ? ['--cpus', sec.cpus] : []),
  ];

  for (const [key, value] of Object.entries(labels)) {
    if (!key || !value) continue;
    args.push('--label', `${key}=${value}`);
  }

  if (apiKey) {
    args.push('-e', `${cfg.apiKeyEnvVar}=${apiKey}`);
  }

  if (opts.claudeOauthToken) {
    args.push('-e', `${CLAUDE_CODE_OAUTH_TOKEN_ENV}=${opts.claudeOauthToken}`);
  }

  // Mount session data first so extra mounts can overlay it
  if (opts.sessionDataDir) {
    validateBindMount(opts.sessionDataDir, cfg.sessionConfigDir);
    args.push('-v', `${opts.sessionDataDir}:${cfg.sessionConfigDir}`);
  }

  for (const mount of extraReadonlyMounts) {
    validateBindMount(mount.hostPath, mount.containerPath);
    const roSuffix = mount.readOnly !== false ? ':ro' : '';
    args.push('-v', `${mount.hostPath}:${mount.containerPath}${roSuffix}`);
  }

  if (opts.extraEnv) {
    for (const [key, value] of Object.entries(opts.extraEnv)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  if (opts.headless) {
    args.push(imageName, 'sleep', 'infinity');
  } else {
    const { command, prefixArgs } = resolveProviderCommand(provider, opts.providerCommandOverrides);
    args.push(imageName, command, ...prefixArgs, ...providerArgs);
  }

  return { command: 'docker', args };
}

type McpOpts = {
  memoryMcpUrl?: string | null;
  threadMcpUrl?: string | null;
  councilMcpUrl?: string | null;
  kanbanMcpUrl?: string | null;
  recordingsMcpUrl?: string | null;
  autopilotMcpUrl?: string | null;
};

type McpServer = { name: string; url: string };

function enabledMcpServers(opts: McpOpts): McpServer[] {
  const candidates: Array<{ name: string; url: string | null | undefined }> = [
    { name: 'agentos-memory', url: opts.memoryMcpUrl },
    { name: 'agentos-thread', url: opts.threadMcpUrl },
    { name: 'agentos-council', url: opts.councilMcpUrl },
    { name: 'agentos-kanban', url: opts.kanbanMcpUrl },
    { name: 'agentos-recordings', url: opts.recordingsMcpUrl },
    { name: 'agentos-autopilot', url: opts.autopilotMcpUrl },
  ];
  return candidates.flatMap(({ name, url }) => (url ? [{ name, url }] : []));
}

/** Builds an env map from optional [key, value] pairs (dropping nullish) plus extra env. */
function execEnv(
  entries: Array<[string, string | null | undefined]>,
  extraEnv?: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value) env[key] = value;
  }
  if (extraEnv) Object.assign(env, extraEnv);
  return env;
}

/**
 * Wraps a resolved provider invocation (`binary` + `cliArgs` + `env`) as either a `docker exec`
 * into the thread's container, or — when `runOnHost` — a direct host command. On host the env is
 * returned for the caller to overlay on the process; under Docker it becomes `-e` flags.
 */
function wrapExec(
  threadId: string,
  command: string,
  prefixArgs: string[],
  cliArgs: string[],
  env: Record<string, string>,
  runOnHost: boolean
): DockerArgs {
  if (runOnHost) {
    return { command, args: [...prefixArgs, ...cliArgs], env };
  }
  const envFlags = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return {
    command: 'docker',
    args: [
      'exec',
      '-it',
      ...envFlags,
      '--user',
      'agent',
      `agentos-session-${threadId}`,
      command,
      ...prefixArgs,
      ...cliArgs,
    ],
  };
}

export function buildDockerExecArgs(
  threadId: string,
  input: string,
  opts: McpOpts & {
    provider: Provider;
    claudeSessionId?: string;
    codexSessionId?: string;
    geminiSessionId?: string;
    piSessionId?: string;
    skipPermissions?: boolean;
    systemPrompt?: string | null;
    systemPromptSuffix?: string | null;
    disallowedTools?: string[];
    allowedTools?: string[];
    claudeOauthToken?: string | null;
    apiKey?: string | null;
    mcpBearerToken?: string | null;
    model?: string;
    effort?: ClaudeEffort;
    reasoning?: CodexReasoning;
    outputFormat?: 'text' | 'stream-json';
    extraEnv?: Record<string, string>;
    /** Run the CLI directly on the host instead of `docker exec` into the container. */
    runOnHost?: boolean;
    /** Per-provider CLI command overrides (e.g. `claude` → `aifx agent claude`). */
    providerCommandOverrides?: Partial<Record<Provider, string>>;
  }
): DockerArgs {
  const skipPermissions = opts.skipPermissions ?? true;
  const runOnHost = opts.runOnHost ?? false;
  const { command, prefixArgs } = resolveProviderCommand(opts.provider, opts.providerCommandOverrides);
  const mcpServers = enabledMcpServers(opts);

  const modelArgs: string[] = !opts.model
    ? []
    : opts.provider === 'codex'
      ? ['-m', opts.model]
      : ['--model', opts.model];

  if (opts.provider === 'codex') {
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${input}` : input;
    const mcpFlags = mcpServers.flatMap(({ name, url }) => [
      '-c',
      `mcp_servers.${name}.url="${url}"`,
      '-c',
      `mcp_servers.${name}.bearer_token_env_var="${AGENTOS_MCP_BEARER_TOKEN_ENV_VAR}"`,
    ]);
    const commonFlags = [
      '--json',
      '--skip-git-repo-check',
      ...(skipPermissions ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
      ...mcpFlags,
    ];
    const subcommand = opts.codexSessionId ? ['exec', 'resume', opts.codexSessionId, prompt] : ['exec', prompt];
    const reasoningArgs: string[] = opts.reasoning ? ['--reasoning', opts.reasoning] : [];
    const env = execEnv(
      [
        [PROVIDER_CONFIGS.codex.apiKeyEnvVar, opts.apiKey],
        [AGENTOS_MCP_BEARER_TOKEN_ENV_VAR, opts.mcpBearerToken],
      ],
      opts.extraEnv
    );
    return wrapExec(
      threadId,
      command,
      prefixArgs,
      [...subcommand, ...commonFlags, ...modelArgs, ...reasoningArgs],
      env,
      runOnHost
    );
  }

  if (opts.provider === 'gemini') {
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${input}` : input;
    const env = execEnv(
      [
        [PROVIDER_CONFIGS.gemini.apiKeyEnvVar, opts.apiKey],
        [AGENTOS_MCP_BEARER_TOKEN_ENV_VAR, opts.mcpBearerToken],
      ],
      opts.extraEnv
    );
    const cliArgs = [
      '--prompt',
      prompt,
      '--output-format',
      opts.outputFormat ?? 'stream-json',
      '--yolo',
      ...(opts.geminiSessionId ? ['--resume', opts.geminiSessionId] : []),
      ...modelArgs,
      ...mcpServers.flatMap(({ name }) => ['--allowed-mcp-server-names', name]),
    ];
    return wrapExec(threadId, command, prefixArgs, cliArgs, env, runOnHost);
  }

  if (opts.provider === 'pi') {
    // Pi CLI has no MCP server flags yet — mcpBearerToken is injected for future use
    // but server URLs are not passed. See council/service.ts for the same caveat.
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${input}` : input;
    const env = execEnv(
      [
        [PROVIDER_CONFIGS.pi.apiKeyEnvVar, opts.apiKey],
        [AGENTOS_MCP_BEARER_TOKEN_ENV_VAR, opts.mcpBearerToken],
      ],
      opts.extraEnv
    );
    const cliArgs = ['-p', ...modelArgs, ...(opts.piSessionId ? ['--session', opts.piSessionId] : []), prompt];
    return wrapExec(threadId, command, prefixArgs, cliArgs, env, runOnHost);
  }

  // Claude (default)
  const outputFormat = opts.outputFormat ?? 'stream-json';
  // When resuming, --append-system-prompt is ignored by Claude Code; inject the per-turn
  // suffix into the user message instead so the model still sees it.
  const effectiveInput =
    opts.claudeSessionId && opts.systemPromptSuffix ? `${opts.systemPromptSuffix}\n\n${input}` : input;
  const cliArgs: string[] = [
    '-p',
    effectiveInput,
    '--output-format',
    outputFormat,
    ...(outputFormat === 'stream-json' ? ['--verbose', '--include-partial-messages'] : []),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ...modelArgs,
    ...(opts.effort ? ['--effort', opts.effort] : []),
  ];

  if (opts.claudeSessionId) {
    cliArgs.push('--resume', opts.claudeSessionId);
  }

  if (opts.systemPrompt) {
    cliArgs.push('--append-system-prompt', opts.systemPrompt);
  }

  if (mcpServers.length > 0) {
    const authHeaders = getMcpAuthHeaders();
    const mcpConfig: Record<string, { type: string; url: string; headers: Record<string, string> }> = {};
    for (const { name, url } of mcpServers) {
      mcpConfig[name] = { type: 'http', url, headers: authHeaders };
    }
    cliArgs.push('--mcp-config', JSON.stringify({ mcpServers: mcpConfig }));
  }

  if (opts.disallowedTools?.length) {
    cliArgs.push('--disallowed-tools', opts.disallowedTools.join(','));
  }

  // Whitelist specific tools so they run without prompting under default permissions
  // (used by the autopilot planner to call its single submit tool autonomously).
  // NOTE: allowedTools is consumed ONLY by this Claude branch. Codex/Gemini have no per-tool
  // allow-list; their isolation comes from which MCP servers are wired via enabledMcpServers
  // (e.g. the planner enables only agentos-autopilot). Do not rely on allowedTools to restrict
  // codex/gemini — restrict their tool surface by limiting the MCP servers passed instead.
  if (opts.allowedTools?.length) {
    cliArgs.push('--allowed-tools', opts.allowedTools.join(','));
  }

  const env = execEnv(
    [
      [PROVIDER_CONFIGS.claude.apiKeyEnvVar, opts.apiKey],
      [CLAUDE_CODE_OAUTH_TOKEN_ENV, opts.claudeOauthToken],
    ],
    opts.extraEnv
  );
  return wrapExec(threadId, command, prefixArgs, cliArgs, env, runOnHost);
}

export async function stopContainer(sessionId: string): Promise<void> {
  const containerName = `agentos-session-${sessionId}`;
  await execFileAsync('docker', ['kill', containerName]).catch((err) => {
    eventLogger.warn('docker', 'docker kill failed', { containerName, error: String(err) });
  });
}
