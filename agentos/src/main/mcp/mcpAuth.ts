import crypto from 'node:crypto';
import type http from 'node:http';

/** Single app-lifetime bearer token for all internal AgentOS MCP servers. */
const MCP_TOKEN = crypto.randomBytes(32).toString('hex');
const AUTH_HEADER_VALUE = `Bearer ${MCP_TOKEN}`;
const AUTH_HEADER_BUF = Buffer.from(AUTH_HEADER_VALUE);
export const AGENTOS_MCP_BEARER_TOKEN_ENV_VAR = 'AGENTOS_MCP_BEARER_TOKEN';

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** When true, requests from loopback addresses skip bearer-token validation. Default: false. */
let localhostAuthBypass = false;

export function setLocalhostAuthBypass(enabled: boolean): void {
  localhostAuthBypass = enabled;
}

export function getMcpToken(): string {
  return MCP_TOKEN;
}

/** Returns the Authorization header object to attach to MCP client configs. */
export function getMcpAuthHeaders(): Record<string, string> {
  return { Authorization: AUTH_HEADER_VALUE };
}

/** Returns true if the request is authorized. */
export function validateMcpAuth(req: http.IncomingMessage): boolean {
  if (localhostAuthBypass && LOOPBACK_ADDRS.has(req.socket.remoteAddress ?? '')) return true;
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  return actual.length === AUTH_HEADER_BUF.length && crypto.timingSafeEqual(actual, AUTH_HEADER_BUF);
}
