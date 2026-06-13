/**
 * Resolves the hostname the agent uses to reach AgentOS's local MCP servers.
 *
 * - In a Docker sandbox the servers run on the host, reachable via the
 *   `host.docker.internal` alias from inside the container.
 * - When the thread runs directly on the host, there is no container network —
 *   the servers are on loopback, so `127.0.0.1` is used instead.
 */
export function mcpHostname(runOnHost: boolean): string {
  return runOnHost ? '127.0.0.1' : 'host.docker.internal';
}

/** Full MCP URL (`http://<host>:<port>/mcp`) for the given port and execution mode. */
export function mcpUrl(port: number, runOnHost: boolean): string {
  return `http://${mcpHostname(runOnHost)}:${port}/mcp`;
}
