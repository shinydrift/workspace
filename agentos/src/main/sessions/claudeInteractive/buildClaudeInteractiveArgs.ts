import type { ClaudeEffort } from '../../../shared/types';
import { PROVIDER_CONFIGS } from '../../utils/providerConfig';
import { CLAUDE_CODE_OAUTH_TOKEN_ENV } from '../threadAuth';
import { getMcpAuthHeaders } from '../../mcp/mcpAuth';

// Builds the `docker exec` args to launch claude inside the per-thread container
// in interactive (PTY) mode with a pre-allocated session id. This is a sibling of
// buildDockerExecArgs's claude branch in utils/docker/sandbox.ts, minus the one-shot
// flags (`-p`, `--output-format`, `--include-partial-messages`). Output is read out
// of band via the JSONL file the session writes to ~/.claude/projects/-workspace/.
export type ClaudeInteractiveArgsOpts = {
  threadId: string;
  sessionId: string; // pre-allocated UUID, passed via --session-id on first spawn or --resume on respawn
  isResume: boolean;
  claudeOauthToken: string | null;
  apiKey: string | null;
  mcpBearerToken: string | null;
  model?: string;
  effort?: ClaudeEffort;
  systemPrompt?: string | null;
  disallowedTools?: string[];
  skipPermissions?: boolean;
  extraEnv?: Record<string, string>;
  /** Run claude directly on the host instead of `docker exec` into the container. */
  runOnHost?: boolean;
  /** Launch-time env to apply to the host process (API keys, backend routing, ids). */
  launchEnv?: Record<string, string>;
  mcp: {
    memoryMcpUrl?: string | null;
    threadMcpUrl?: string | null;
    councilMcpUrl?: string | null;
    slackMcpUrl?: string | null;
    kanbanMcpUrl?: string | null;
    recordingsMcpUrl?: string | null;
  };
};

function enabledMcp(mcp: ClaudeInteractiveArgsOpts['mcp']): Array<{ name: string; url: string }> {
  const candidates: Array<{ name: string; url: string | null | undefined }> = [
    { name: 'agentos-memory', url: mcp.memoryMcpUrl },
    { name: 'agentos-thread', url: mcp.threadMcpUrl },
    { name: 'agentos-council', url: mcp.councilMcpUrl },
    { name: 'agentos-slack', url: mcp.slackMcpUrl },
    { name: 'agentos-kanban', url: mcp.kanbanMcpUrl },
    { name: 'agentos-recordings', url: mcp.recordingsMcpUrl },
  ];
  return candidates.flatMap(({ name, url }) => (url ? [{ name, url }] : []));
}

export function buildClaudeInteractiveArgs(opts: ClaudeInteractiveArgsOpts): {
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  const skipPermissions = opts.skipPermissions ?? true;
  const mcpServers = enabledMcp(opts.mcp);

  const cliArgs: string[] = [
    ...(opts.isResume ? ['--resume', opts.sessionId] : ['--session-id', opts.sessionId]),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.effort ? ['--effort', opts.effort] : []),
  ];

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

  // The per-exec env: api key (council members), oauth, and per-turn extras. Under Docker these
  // become `-e` flags and must stay minimal — the container already holds launchEnv from `run`,
  // so folding launchEnv in here would both duplicate it and expose its secrets (GH_TOKEN,
  // TS_AUTHKEY, safelisted vars) in the `docker exec` argv. launchEnv is applied ONLY on host,
  // where there is no container to have baked it in.
  const execEnvMap: Record<string, string> = {
    ...(opts.apiKey ? { [PROVIDER_CONFIGS.claude.apiKeyEnvVar]: opts.apiKey } : {}),
    ...(opts.claudeOauthToken ? { [CLAUDE_CODE_OAUTH_TOKEN_ENV]: opts.claudeOauthToken } : {}),
    ...(opts.extraEnv ?? {}),
  };

  if (opts.runOnHost) {
    return { command: 'claude', args: cliArgs, env: { ...(opts.launchEnv ?? {}), ...execEnvMap } };
  }

  const envFlags = Object.entries(execEnvMap).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return {
    command: 'docker',
    args: ['exec', '-it', ...envFlags, '--user', 'agent', `agentos-session-${opts.threadId}`, 'claude', ...cliArgs],
  };
}
