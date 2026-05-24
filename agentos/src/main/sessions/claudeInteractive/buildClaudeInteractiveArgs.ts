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
  mcp: {
    memoryMcpUrl?: string | null;
    threadMcpUrl?: string | null;
    councilMcpUrl?: string | null;
    slackMcpUrl?: string | null;
    kanbanMcpUrl?: string | null;
    recordingsMcpUrl?: string | null;
  };
};

function envArg(key: string, value: string | null | undefined): string[] {
  return value ? ['-e', `${key}=${value}`] : [];
}

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
} {
  const skipPermissions = opts.skipPermissions ?? true;
  const mcpServers = enabledMcp(opts.mcp);

  const args: string[] = [
    'exec',
    '-it',
    ...envArg(PROVIDER_CONFIGS.claude.apiKeyEnvVar, opts.apiKey),
    '--user',
    'agent',
    ...envArg(CLAUDE_CODE_OAUTH_TOKEN_ENV, opts.claudeOauthToken),
    ...Object.entries(opts.extraEnv ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    `agentos-session-${opts.threadId}`,
    'claude',
    ...(opts.isResume ? ['--resume', opts.sessionId] : ['--session-id', opts.sessionId]),
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.effort ? ['--effort', opts.effort] : []),
  ];

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  if (mcpServers.length > 0) {
    const authHeaders = getMcpAuthHeaders();
    const mcpConfig: Record<string, { type: string; url: string; headers: Record<string, string> }> = {};
    for (const { name, url } of mcpServers) {
      mcpConfig[name] = { type: 'http', url, headers: authHeaders };
    }
    args.push('--mcp-config', JSON.stringify({ mcpServers: mcpConfig }));
  }

  if (opts.disallowedTools?.length) {
    args.push('--disallowed-tools', opts.disallowedTools.join(','));
  }

  return { command: 'docker', args };
}
