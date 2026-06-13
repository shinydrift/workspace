import { buildDockerRunArgs } from '../utils/docker';
import { buildHeadlessSystemPrompt } from './systemPromptBuilder';
import { readClaudeOauthToken, CLAUDE_CODE_OAUTH_TOKEN_ENV } from './threadAuth';
import { PROVIDER_CONFIGS } from '../utils/providerConfig';
import type { SandboxSecuritySettings, Thread, Provider } from '../../shared/types';
import { getHostShellEnv, filterEnvBySafelist } from '../utils/hostEnv';
import { integrationContextManager } from '../integrations/IntegrationContextManager';
import { getTask } from '../kanban/db';
import { eventLogger } from '../utils/eventLog';
import { AGENTOS_MCP_BEARER_TOKEN_ENV_VAR, getMcpToken } from '../mcp/mcpAuth';

export type ThreadLaunchArgs = {
  command: string;
  args: string[];
  effectiveSystemPrompt: string | undefined;
  /**
   * The full env Docker bakes into the container at `run` time. On host execution the launch
   * process (a keep-alive placeholder) holds no env, so callers stash this and overlay it onto
   * each per-turn host process. Empty for the Docker path.
   */
  launchEnv: Record<string, string>;
  memoryMcpUrl: string | null;
  threadMcpUrl: string | null;
  councilMcpUrl: string | null;
  slackMcpUrl: string | null;
  kanbanMcpUrl: string | null;
  recordingsMcpUrl: string | null;
};

async function resolvedSafelistEnv(
  envSafelist: string[] | undefined,
  threadId: string
): Promise<Record<string, string>> {
  if (!envSafelist || envSafelist.length === 0) return {};
  const matched = filterEnvBySafelist(await getHostShellEnv(), envSafelist);
  if (Object.keys(matched).length > 0) {
    eventLogger.info('sandbox', 'Host env vars passed to container via safelist', {
      threadId,
      matched: Object.keys(matched),
    });
  }
  return matched;
}

export async function buildThreadLaunchArgs(params: {
  threadId: string;
  stored: Omit<Thread, 'logBuffer'>;
  provider: Provider;
  imageName: string;
  apiKey: string | undefined;
  effectiveSandbox: SandboxSecuritySettings;
  runOnHost: boolean;
  providerArgs: string[];
  extraReadonlyMounts: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  configHash: string;
  injectionPayload: { payload?: string | null };
  useHeadless: boolean;
  sessionDataDir: string;
  slackMcpPort: number;
  memoryMcpPort: number;
  threadMcpPort: number;
  councilMcpPort: number;
  kanbanMcpPort: number;
  recordingsMcpPort: number;
  tailscaleAuthKey?: string;
  tailscaleFunnel?: boolean;
  githubToken?: string | null;
  envSafelist?: string[];
  envVars?: Record<string, string>;
  seccompProfilePath?: string;
}): Promise<ThreadLaunchArgs> {
  const {
    threadId,
    stored,
    provider,
    imageName,
    apiKey,
    effectiveSandbox,
    runOnHost,
    providerArgs,
    extraReadonlyMounts,
    configHash,
    injectionPayload,
    useHeadless,
    sessionDataDir,
    slackMcpPort,
    memoryMcpPort,
    threadMcpPort,
    councilMcpPort,
    kanbanMcpPort,
    recordingsMcpPort,
    tailscaleAuthKey,
    tailscaleFunnel,
    githubToken,
    envSafelist,
    envVars,
    seccompProfilePath,
  } = params;

  const task = stored.agentRole && stored.taskId ? getTask(stored.projectId, stored.taskId) : null;

  const {
    effectiveSystemPrompt,
    extraEnv,
    memoryMcpUrl,
    threadMcpUrl,
    councilMcpUrl,
    slackMcpUrl,
    kanbanMcpUrl,
    recordingsMcpUrl,
  } = buildHeadlessSystemPrompt({
    initialPayload: injectionPayload.payload ?? null,
    slackCtx: integrationContextManager.getSlackContext(threadId) ?? null,
    useHeadless,
    runOnHost,
    projectId: stored.projectId,
    threadId,
    slackMcpPort,
    memoryMcpPort,
    threadMcpPort,
    councilMcpPort,
    kanbanMcpPort,
    recordingsMcpPort,
    agentRole: stored.agentRole ?? null,

    taskCtx: task
      ? {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
        }
      : null,
  });

  const claudeOauthToken = await readClaudeOauthToken();
  const containerEnv: Record<string, string> = {
    ...(envVars ?? {}),
    ...(await resolvedSafelistEnv(envSafelist, threadId)),
    ...(extraEnv ?? {}),
    ...(provider === 'codex' ? { [AGENTOS_MCP_BEARER_TOKEN_ENV_VAR]: getMcpToken() } : {}),
    ...(tailscaleAuthKey
      ? {
          TS_AUTHKEY: tailscaleAuthKey,
          TS_HOSTNAME: `agentos-${threadId.slice(0, 8)}`,
          ...(tailscaleFunnel ? { TS_FUNNEL_PORT: '3000' } : {}),
        }
      : {}),
    ...(githubToken ? { GH_TOKEN: githubToken } : {}),
  };

  // Full env that Docker would bake into the container. On host, no long-lived container holds
  // it, so it is captured here and replayed onto each per-turn process (see headlessRunner).
  const launchEnv: Record<string, string> = {
    ...(apiKey ? { [PROVIDER_CONFIGS[provider].apiKeyEnvVar]: apiKey } : {}),
    ...(claudeOauthToken ? { [CLAUDE_CODE_OAUTH_TOKEN_ENV]: claudeOauthToken } : {}),
    ...containerEnv,
  };

  if (runOnHost) {
    // No container to exec into; per-turn host processes are spawned directly (headlessRunner,
    // claude-interactive, etc.). The launch process is just a keep-alive placeholder so the
    // existing "thread is running" lifecycle (store.ptys) holds unchanged. 2147483647s ≈ 68y.
    return {
      command: 'sleep',
      args: ['2147483647'],
      effectiveSystemPrompt,
      launchEnv,
      memoryMcpUrl,
      threadMcpUrl,
      councilMcpUrl,
      slackMcpUrl,
      kanbanMcpUrl,
      recordingsMcpUrl,
    };
  }

  const dockerArgs = buildDockerRunArgs(
    threadId,
    stored.workingDirectory,
    imageName,
    provider,
    apiKey,
    effectiveSandbox,
    providerArgs,
    extraReadonlyMounts,
    {
      'agentos.managed': '1',
      'agentos.threadId': threadId,
      'agentos.createdAtMs': String(Date.now()),
      'agentos.configHash': configHash,
    },
    {
      headless: useHeadless,
      claudeOauthToken,
      sessionDataDir,
      seccompProfilePath,
      extraEnv: containerEnv,
    }
  );

  return {
    command: dockerArgs.command,
    args: dockerArgs.args,
    effectiveSystemPrompt,
    launchEnv,
    memoryMcpUrl,
    threadMcpUrl,
    councilMcpUrl,
    slackMcpUrl,
    kanbanMcpUrl,
    recordingsMcpUrl,
  };
}
