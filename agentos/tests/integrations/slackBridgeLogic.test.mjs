/**
 * Tests for integrations/slackBridge.ts — additional pure logic (inlined).
 *
 * Covers: applySettings gating, onThreadStatus emoji selection,
 * processInboundMessage message guards + commandBody routing,
 * postWorkspaceMenu line building, handleWorkspaceSelection resolution,
 * listDiscoverableChannels filter+sort, resolveRootThreadTs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── applySettings gating logic ────────────────────────────────────────────────

function computeHasBotAccess(enabled, botToken) {
  return enabled && Boolean(botToken?.trim());
}

function computeHasSocketMode(hasBotAccess, appToken, watchedChannelIds) {
  return hasBotAccess && Boolean(appToken?.trim()) && watchedChannelIds.length > 0;
}

test('applySettings: disabled with token -> no bot access', () => {
  assert.equal(computeHasBotAccess(false, 'xoxb-token'), false);
});

test('applySettings: enabled with empty token -> no bot access', () => {
  assert.equal(computeHasBotAccess(true, ''), false);
});

test('applySettings: enabled with whitespace token -> no bot access', () => {
  assert.equal(computeHasBotAccess(true, '   '), false);
});

test('applySettings: enabled with valid token -> has bot access', () => {
  assert.equal(computeHasBotAccess(true, 'xoxb-token'), true);
});

test('applySettings: no bot access -> no socket mode', () => {
  assert.equal(computeHasSocketMode(false, 'xapp-token', ['C123']), false);
});

test('applySettings: bot access but no app token -> no socket mode', () => {
  assert.equal(computeHasSocketMode(true, '', ['C123']), false);
});

test('applySettings: bot access and app token but no channels -> no socket mode', () => {
  assert.equal(computeHasSocketMode(true, 'xapp-token', []), false);
});

test('applySettings: bot access, app token, channels -> has socket mode', () => {
  assert.equal(computeHasSocketMode(true, 'xapp-token', ['C123']), true);
});

// ── onThreadStatus emoji selection ────────────────────────────────────────────

function computeStatusFlags(payload) {
  const isError = payload.status === 'error';
  const isTurnComplete = payload.status === 'running' && (payload.queueDepth ?? 0) === 0;
  return { isError, isTurnComplete };
}

function computeDoneEmoji(isError) {
  return isError ? 'x' : 'white_check_mark';
}


test('onThreadStatus: error status -> isError=true', () => {
  const { isError, isTurnComplete } = computeStatusFlags({ status: 'error' });
  assert.equal(isError, true);
  assert.equal(isTurnComplete, false);
});

test('onThreadStatus: running with queueDepth 0 -> isTurnComplete=true', () => {
  const { isError, isTurnComplete } = computeStatusFlags({ status: 'running', queueDepth: 0 });
  assert.equal(isError, false);
  assert.equal(isTurnComplete, true);
});

test('onThreadStatus: running with queueDepth 1 -> neither flag', () => {
  const { isError, isTurnComplete } = computeStatusFlags({ status: 'running', queueDepth: 1 });
  assert.equal(isError, false);
  assert.equal(isTurnComplete, false);
});

test('onThreadStatus: running with no queueDepth defaults to 0 -> isTurnComplete=true', () => {
  const { isTurnComplete } = computeStatusFlags({ status: 'running' });
  assert.equal(isTurnComplete, true);
});

test('onThreadStatus: stopped status -> neither flag', () => {
  const { isError, isTurnComplete } = computeStatusFlags({ status: 'stopped' });
  assert.equal(isError, false);
  assert.equal(isTurnComplete, false);
});

test('doneEmoji: error -> x', () => {
  assert.equal(computeDoneEmoji(true), 'x');
});

test('doneEmoji: success -> white_check_mark', () => {
  assert.equal(computeDoneEmoji(false), 'white_check_mark');
});


// ── processInboundMessage: message guard logic ────────────────────────────────

/**
 * Returns true if the message should be filtered out (i.e. early-return).
 */
function shouldFilterMessage(message) {
  if ((message.subtype && message.subtype !== 'file_share') || message.bot_id || !message.user) return true;
  const hasFiles = (message.files?.length ?? 0) > 0;
  if (!message.text && !hasFiles) return true;
  return false;
}

test('guard: bot_id set -> filter', () => {
  assert.equal(shouldFilterMessage({ bot_id: 'B123', user: 'U123', text: 'hello' }), true);
});

test('guard: no user -> filter', () => {
  assert.equal(shouldFilterMessage({ text: 'hello' }), true);
});

test('guard: subtype message_deleted -> filter', () => {
  assert.equal(shouldFilterMessage({ subtype: 'message_deleted', user: 'U123', text: 'hello' }), true);
});

test('guard: subtype file_share -> allow through', () => {
  assert.equal(shouldFilterMessage({ subtype: 'file_share', user: 'U123', files: [{ id: 'F1' }] }), false);
});

test('guard: no text and no files -> filter', () => {
  assert.equal(shouldFilterMessage({ user: 'U123', text: '' }), true);
});

test('guard: no text but has files -> allow', () => {
  assert.equal(shouldFilterMessage({ user: 'U123', text: '', files: [{ id: 'F1' }] }), false);
});

test('guard: valid human message with text -> allow', () => {
  assert.equal(shouldFilterMessage({ user: 'U123', text: 'do the thing' }), false);
});

// ── processInboundMessage: commandBody routing ────────────────────────────────

function classifyCommandBody(commandBody) {
  const normalized = commandBody.toLowerCase();
  if (normalized === 'workspace') return 'workspace';
  if (normalized === 'workspaces') return 'workspaces';
  if (normalized.startsWith('use ')) return 'use';
  return 'task';
}

test('routing: "workspace" -> workspace', () => {
  assert.equal(classifyCommandBody('workspace'), 'workspace');
});

test('routing: "WORKSPACE" (case-insensitive) -> workspace', () => {
  assert.equal(classifyCommandBody('WORKSPACE'), 'workspace');
});

test('routing: "workspaces" -> workspaces', () => {
  assert.equal(classifyCommandBody('workspaces'), 'workspaces');
});

test('routing: "use 2" -> use', () => {
  assert.equal(classifyCommandBody('use 2'), 'use');
});

test('routing: "use /home/user/project" -> use', () => {
  assert.equal(classifyCommandBody('use /home/user/project'), 'use');
});

test('routing: "do some task" -> task', () => {
  assert.equal(classifyCommandBody('do some task'), 'task');
});

test('routing: "usefoo" (no space after use) -> task', () => {
  assert.equal(classifyCommandBody('usefoo'), 'task');
});

// ── handleWorkspaceSelection: index vs string resolution ──────────────────────

const OPTIONS = [
  { id: 'proj-a', path: '/home/user/alpha', name: 'Alpha' },
  { id: 'proj-b', path: '/home/user/beta', name: 'Beta' },
  { id: 'proj-c', path: '/home/user/gamma', name: 'Gamma' },
];

function resolveWorkspaceSelection(rawValue, options) {
  const index = Number(rawValue);
  if (Number.isFinite(index) && index >= 1 && index <= options.length) {
    return options[index - 1];
  }
  return options.find((o) => o.id === rawValue || o.path === rawValue) ?? null;
}

test('handleWorkspaceSelection: "1" selects first option', () => {
  const result = resolveWorkspaceSelection('1', OPTIONS);
  assert.equal(result?.id, 'proj-a');
});

test('handleWorkspaceSelection: "3" selects third option', () => {
  const result = resolveWorkspaceSelection('3', OPTIONS);
  assert.equal(result?.id, 'proj-c');
});

test('handleWorkspaceSelection: "0" is out-of-range -> falls through to string match', () => {
  // 0 is not >= 1, so it will try id/path match, which fails -> null
  assert.equal(resolveWorkspaceSelection('0', OPTIONS), null);
});

test('handleWorkspaceSelection: out-of-range number -> null', () => {
  assert.equal(resolveWorkspaceSelection('99', OPTIONS), null);
});

test('handleWorkspaceSelection: id match', () => {
  const result = resolveWorkspaceSelection('proj-b', OPTIONS);
  assert.equal(result?.id, 'proj-b');
});

test('handleWorkspaceSelection: path match', () => {
  const result = resolveWorkspaceSelection('/home/user/gamma', OPTIONS);
  assert.equal(result?.id, 'proj-c');
});

test('handleWorkspaceSelection: unknown string -> null', () => {
  assert.equal(resolveWorkspaceSelection('nonexistent', OPTIONS), null);
});

// ── postWorkspaceMenu: line building ─────────────────────────────────────────

function buildWorkspaceMenuLines(options, selectedPath) {
  return options.slice(0, 12).map((option, index) => {
    const marker = selectedPath && option.path === selectedPath ? ' (selected)' : '';
    return `${index + 1}. ${option.name} - ${option.path}${marker}`;
  });
}

test('postWorkspaceMenu: formats options as numbered list', () => {
  const lines = buildWorkspaceMenuLines(OPTIONS, null);
  assert.equal(lines[0], '1. Alpha - /home/user/alpha');
  assert.equal(lines[1], '2. Beta - /home/user/beta');
  assert.equal(lines[2], '3. Gamma - /home/user/gamma');
});

test('postWorkspaceMenu: marks selected path', () => {
  const lines = buildWorkspaceMenuLines(OPTIONS, '/home/user/beta');
  assert.ok(lines[1].includes('(selected)'));
  assert.ok(!lines[0].includes('(selected)'));
});

test('postWorkspaceMenu: null selectedPath shows no marker', () => {
  const lines = buildWorkspaceMenuLines(OPTIONS, null);
  assert.ok(lines.every((l) => !l.includes('(selected)')));
});

test('postWorkspaceMenu: caps at 12 options', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, path: `/p${i}`, name: `P${i}` }));
  const lines = buildWorkspaceMenuLines(many, null);
  assert.equal(lines.length, 12);
});

// ── listDiscoverableChannels: filter + sort ───────────────────────────────────

function filterAndSortChannels(channels) {
  return channels.filter((ch) => ch.isMember).sort((a, b) => a.name.localeCompare(b.name));
}

test('listDiscoverableChannels: excludes non-member channels', () => {
  const channels = [
    { id: 'C1', name: 'alpha', isMember: true },
    { id: 'C2', name: 'beta', isMember: false },
  ];
  const result = filterAndSortChannels(channels);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'C1');
});

test('listDiscoverableChannels: sorts by name alphabetically', () => {
  const channels = [
    { id: 'C3', name: 'zebra', isMember: true },
    { id: 'C1', name: 'alpha', isMember: true },
    { id: 'C2', name: 'mango', isMember: true },
  ];
  const result = filterAndSortChannels(channels);
  assert.equal(result[0].name, 'alpha');
  assert.equal(result[1].name, 'mango');
  assert.equal(result[2].name, 'zebra');
});

test('listDiscoverableChannels: empty list returns empty', () => {
  assert.deepEqual(filterAndSortChannels([]), []);
});

// ── resolveRootThreadTs: pure path (no web client) ────────────────────────────

function resolveRootThreadTs(messageTs, explicitThreadTs) {
  if (explicitThreadTs && explicitThreadTs.trim()) return explicitThreadTs;
  return messageTs; // falls back to messageTs when no webClient
}

test('resolveRootThreadTs: explicit threadTs is returned as-is', () => {
  assert.equal(resolveRootThreadTs('1000.0', '999.0'), '999.0');
});

test('resolveRootThreadTs: whitespace-only threadTs falls back to messageTs', () => {
  assert.equal(resolveRootThreadTs('1000.0', '   '), '1000.0');
});

test('resolveRootThreadTs: undefined threadTs falls back to messageTs', () => {
  assert.equal(resolveRootThreadTs('1000.0', undefined), '1000.0');
});

test('resolveRootThreadTs: empty string falls back to messageTs', () => {
  assert.equal(resolveRootThreadTs('1000.0', ''), '1000.0');
});
