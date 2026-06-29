import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { AGENTOS_MCP_BEARER_TOKEN_ENV_VAR, getMcpAuthHeaders } from '../mcp/mcpAuth';

type LaunchMode = {
  memoryMcpUrl: string | null;
  threadMcpUrl: string | null;
  kanbanMcpUrl: string | null;
  recordingsMcpUrl: string | null;
  runOnHost?: boolean;
};

// Kept in sync with the servers we write below, plus 'agentos-slack' which is no longer written but
// must still be purged from any config files left over from before it was removed.
const AGENTOS_MANAGED_SERVERS = [
  'agentos-memory',
  'agentos-thread',
  'agentos-slack',
  'agentos-kanban',
  'agentos-recordings',
];

// Gemini CLI: <sessionDataDir>/settings.json (bind-mounted as /home/agent/.gemini in container)
function syncGeminiMcpConfig(servers: Record<string, string>, sessionDataDir: string): void {
  const settingsPath = path.join(sessionDataDir, 'settings.json');
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      eventLogger.warn('thread', 'Failed to parse existing settings.json; preserving no prior AgentOS entries', {
        error: getErrorMessage(error),
      });
    }
  }
  const currentServers = { ...((existing.mcpServers as Record<string, unknown>) ?? {}) };
  for (const name of AGENTOS_MANAGED_SERVERS) {
    delete currentServers[name];
  }
  const authHeaders = getMcpAuthHeaders();
  for (const [name, url] of Object.entries(servers)) {
    currentServers[name] = { type: 'http', url, headers: authHeaders };
  }
  const next: Record<string, unknown> = { ...existing };
  if (Object.keys(currentServers).length > 0) {
    next.mcpServers = currentServers;
  } else {
    delete next.mcpServers;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
}

// Codex CLI: <sessionDataDir>/config.toml (bind-mounted as /home/agent/.codex in container)
function syncCodexMcpConfig(servers: Record<string, string>, sessionDataDir: string): void {
  const configPath = path.join(sessionDataDir, 'config.toml');
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = parseToml(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      eventLogger.warn('thread', 'Failed to parse existing config.toml; preserving no prior AgentOS entries', {
        error: getErrorMessage(error),
      });
    }
  }
  const currentServers = { ...((existing.mcp_servers as Record<string, unknown>) ?? {}) };
  for (const name of AGENTOS_MANAGED_SERVERS) {
    delete currentServers[name];
  }
  for (const [name, url] of Object.entries(servers)) {
    currentServers[name] = { url, bearer_token_env_var: AGENTOS_MCP_BEARER_TOKEN_ENV_VAR };
  }
  const next: Record<string, unknown> = { ...existing };
  if (Object.keys(currentServers).length > 0) {
    next.mcp_servers = currentServers;
  } else {
    delete next.mcp_servers;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, stringifyToml(next));
}

// Claude Code receives MCP servers via --mcp-config inline JSON at exec time (see buildDockerExecArgs).
// Only Gemini and Codex require file-based config in their session directories.
export function rebuildManagedMcpConfig(
  launchModes: ReadonlyMap<string, LaunchMode>,
  threads: Record<string, { provider?: string }>,
  sessionsDataDir: string
): void {
  for (const [threadId, launchMode] of launchModes.entries()) {
    const thread = threads[threadId];
    if (!thread) continue;

    const servers: Record<string, string> = {};
    if (launchMode.memoryMcpUrl) servers['agentos-memory'] = launchMode.memoryMcpUrl;
    if (launchMode.threadMcpUrl) servers['agentos-thread'] = launchMode.threadMcpUrl;
    if (launchMode.kanbanMcpUrl) servers['agentos-kanban'] = launchMode.kanbanMcpUrl;
    if (launchMode.recordingsMcpUrl) servers['agentos-recordings'] = launchMode.recordingsMcpUrl;

    const sessionDataDir = path.join(sessionsDataDir, threadId);
    if (thread.provider === 'gemini') {
      // Under Docker, sessionDataDir is bind-mounted to /home/agent/.gemini. On host there is no
      // mount and the CLI reads the user's real ~/.gemini, so write the managed servers there
      // (the sync is non-destructive — it only owns the agentos-* entries).
      syncGeminiMcpConfig(servers, launchMode.runOnHost ? path.join(os.homedir(), '.gemini') : sessionDataDir);
    } else if (thread.provider === 'codex' && !launchMode.runOnHost) {
      // Codex receives MCP servers via inline `-c` flags at exec time (both Docker and host), so
      // config.toml is only needed for the Docker bind mount. Skip on host to avoid mutating ~/.codex.
      syncCodexMcpConfig(servers, sessionDataDir);
    }
  }
}
