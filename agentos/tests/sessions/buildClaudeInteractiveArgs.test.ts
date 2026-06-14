/**
 * Tests for sessions/claudeInteractive/buildClaudeInteractiveArgs.
 *
 * Focus: the autopilot-planner additions — `--allowed-tools` (least-privilege) and the
 * `agentos-autopilot` MCP server wiring. These guard against the interactive planner
 * silently regaining full tool access or losing the submit_autopilot_decision tool.
 *
 * buildClaudeInteractiveArgs transitively imports eventLog, which pulls electron's
 * BrowserWindow at module load — stub 'electron' before importing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// @ts-expect-error — private Node API
const originalLoad = Module._load;
// @ts-expect-error — Module._load signature is not in @types/node
Module._load = function (...args: [string, unknown, boolean]) {
  if (args[0] === 'electron') return { BrowserWindow: class {}, app: { getPath: () => '/tmp' } };
  // @ts-expect-error — forwarding rest args to private API
  return originalLoad.apply(this, args);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildClaudeInteractiveArgs } = require('../../src/main/sessions/claudeInteractive/buildClaudeInteractiveArgs');

// @ts-expect-error — restore private API
Module._load = originalLoad;

const AUTOPILOT_TOOL = 'mcp__agentos-autopilot__submit_autopilot_decision';

function baseOpts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    threadId: 't1',
    sessionId: 's1',
    isResume: false,
    claudeOauthToken: null,
    apiKey: null,
    mcpBearerToken: null,
    mcp: {},
    ...overrides,
  };
}

test('emits --allowed-tools when allowedTools is set', () => {
  const { args } = buildClaudeInteractiveArgs(baseOpts({ allowedTools: ['mcp__agentos-autopilot', AUTOPILOT_TOOL] }));
  const idx = args.indexOf('--allowed-tools');
  assert.notEqual(idx, -1, 'expected --allowed-tools in args');
  assert.equal(args[idx + 1], `mcp__agentos-autopilot,${AUTOPILOT_TOOL}`);
});

test('omits --allowed-tools when allowedTools is absent or empty', () => {
  assert.equal(buildClaudeInteractiveArgs(baseOpts()).args.includes('--allowed-tools'), false);
  assert.equal(buildClaudeInteractiveArgs(baseOpts({ allowedTools: [] })).args.includes('--allowed-tools'), false);
});

test('wires the agentos-autopilot MCP server into --mcp-config', () => {
  const { args } = buildClaudeInteractiveArgs(baseOpts({ mcp: { autopilotMcpUrl: 'http://127.0.0.1:9999/mcp' } }));
  const idx = args.indexOf('--mcp-config');
  assert.notEqual(idx, -1, 'expected --mcp-config in args');
  const cfg = JSON.parse(args[idx + 1]);
  assert.deepEqual(Object.keys(cfg.mcpServers), ['agentos-autopilot']);
  assert.equal(cfg.mcpServers['agentos-autopilot'].url, 'http://127.0.0.1:9999/mcp');
  assert.ok(cfg.mcpServers['agentos-autopilot'].headers.Authorization?.startsWith('Bearer '));
});

test('does not add --mcp-config when no MCP urls are provided', () => {
  assert.equal(buildClaudeInteractiveArgs(baseOpts()).args.includes('--mcp-config'), false);
});
