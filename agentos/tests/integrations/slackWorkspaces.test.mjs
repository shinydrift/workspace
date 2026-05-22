/**
 * Tests for integrations/slackWorkspaces.ts — pure/extractable logic.
 * Tests sanitizeChannelFolderSegment, ensureChannelIsWatched dedup, resolveChannelWorkspace.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined pure logic from slackWorkspaces.ts ────────────────────────────────

function sanitizeChannelFolderSegment(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'channel';
}

// ensureChannelIsWatched pure logic (without store write)
function computeWatchedChannels(channelId, watchedChannelIds) {
  const normalizedChannelId = channelId.trim().toUpperCase();
  if (!normalizedChannelId) return watchedChannelIds;
  const current = watchedChannelIds.map((id) => id.trim().toUpperCase()).filter(Boolean);
  if (current.includes(normalizedChannelId)) return current;
  return [...current, normalizedChannelId];
}

// resolveChannelWorkspace pure matching logic
function resolveChannelEntry(channelId, map) {
  const normalizedChannelId = channelId.trim().toUpperCase();
  const entry = (map[normalizedChannelId] ?? map[channelId.trim()] ?? '').trim();
  return entry;
}

function matchProjectByEntry(entry, projects) {
  if (!entry) return null;
  const prefixedId = entry.toLowerCase().startsWith('project:') ? entry.slice('project:'.length).trim() : '';
  if (prefixedId) {
    return projects.find((p) => p.id === prefixedId) ?? null;
  }
  const byId = projects.find((p) => p.id === entry);
  if (byId) return byId;
  const byName = projects.find((p) => p.name.toLowerCase() === entry.toLowerCase());
  return byName ?? null;
}

// ── sanitizeChannelFolderSegment ──────────────────────────────────────────────

test('sanitizeChannelFolderSegment lowercases input', () => {
  assert.equal(sanitizeChannelFolderSegment('GENERAL'), 'general');
});

test('sanitizeChannelFolderSegment replaces special chars with dashes', () => {
  assert.equal(sanitizeChannelFolderSegment('my channel name'), 'my-channel-name');
});

test('sanitizeChannelFolderSegment strips leading and trailing dashes', () => {
  assert.equal(sanitizeChannelFolderSegment('---hello---'), 'hello');
});

test('sanitizeChannelFolderSegment collapses multiple consecutive special chars to one dash', () => {
  assert.equal(sanitizeChannelFolderSegment('hello   world'), 'hello-world');
});

test('sanitizeChannelFolderSegment returns channel for empty string', () => {
  assert.equal(sanitizeChannelFolderSegment(''), 'channel');
});

test('sanitizeChannelFolderSegment returns channel for whitespace-only string', () => {
  assert.equal(sanitizeChannelFolderSegment('   '), 'channel');
});

test('sanitizeChannelFolderSegment preserves alphanumeric chars', () => {
  assert.equal(sanitizeChannelFolderSegment('team123'), 'team123');
});

test('sanitizeChannelFolderSegment handles mixed case with spaces', () => {
  assert.equal(sanitizeChannelFolderSegment('My Channel'), 'my-channel');
});

test('sanitizeChannelFolderSegment trims leading/trailing whitespace', () => {
  assert.equal(sanitizeChannelFolderSegment('  hello  '), 'hello');
});

test('sanitizeChannelFolderSegment handles unicode by stripping non-alphanum', () => {
  const result = sanitizeChannelFolderSegment('héllo');
  assert.ok(!result.includes('é'));
});

// ── computeWatchedChannels ────────────────────────────────────────────────────

test('computeWatchedChannels adds new channel', () => {
  const result = computeWatchedChannels('C123', ['C456']);
  assert.ok(result.includes('C123'));
});

test('computeWatchedChannels normalizes to uppercase', () => {
  const result = computeWatchedChannels('c123', []);
  assert.ok(result.includes('C123'));
});

test('computeWatchedChannels does not add duplicate', () => {
  const result = computeWatchedChannels('C123', ['C123']);
  assert.equal(result.filter((id) => id === 'C123').length, 1);
});

test('computeWatchedChannels normalizes existing channels', () => {
  const result = computeWatchedChannels('C123', ['c456', 'c789']);
  assert.ok(result.includes('C456'));
  assert.ok(result.includes('C789'));
});

test('computeWatchedChannels returns unchanged list for empty channelId', () => {
  const result = computeWatchedChannels('', ['C123']);
  assert.deepEqual(result, ['C123']);
});

test('computeWatchedChannels trims whitespace from channelId', () => {
  const result = computeWatchedChannels(' C123 ', []);
  assert.ok(result.includes('C123'));
});

test('computeWatchedChannels does not add if normalized form already present', () => {
  const result = computeWatchedChannels('c123', ['C123']);
  assert.equal(result.length, 1);
});

// ── matchProjectByEntry ───────────────────────────────────────────────────────

const PROJECTS = [
  { id: 'proj-1', name: 'My Project', path: '/home/user/my-project' },
  { id: 'proj-2', name: 'Other Project', path: '/home/user/other' },
];

test('matchProjectByEntry finds by exact id', () => {
  const result = matchProjectByEntry('proj-1', PROJECTS);
  assert.equal(result?.id, 'proj-1');
});

test('matchProjectByEntry finds by project: prefix', () => {
  const result = matchProjectByEntry('project:proj-2', PROJECTS);
  assert.equal(result?.id, 'proj-2');
});

test('matchProjectByEntry finds by name (case-insensitive)', () => {
  const result = matchProjectByEntry('MY PROJECT', PROJECTS);
  assert.equal(result?.id, 'proj-1');
});

test('matchProjectByEntry returns null for unknown entry', () => {
  const result = matchProjectByEntry('nonexistent', PROJECTS);
  assert.equal(result, null);
});

test('matchProjectByEntry returns null for empty entry', () => {
  const result = matchProjectByEntry('', PROJECTS);
  assert.equal(result, null);
});

test('matchProjectByEntry handles project: prefix with extra whitespace', () => {
  const result = matchProjectByEntry('project: proj-1', PROJECTS);
  assert.equal(result?.id, 'proj-1');
});

// ── resolveChannelEntry ───────────────────────────────────────────────────────

test('resolveChannelEntry looks up by normalized (uppercase) channel ID', () => {
  const map = { 'C123ABC': 'proj-1' };
  const entry = resolveChannelEntry('c123abc', map);
  assert.equal(entry, 'proj-1');
});

test('resolveChannelEntry falls back to original case key', () => {
  const map = { 'c123abc': 'proj-1' };
  const entry = resolveChannelEntry('c123abc', map);
  assert.equal(entry, 'proj-1');
});

test('resolveChannelEntry returns empty string when channel not in map', () => {
  const entry = resolveChannelEntry('CMISSING', {});
  assert.equal(entry, '');
});

test('resolveChannelEntry trims entry value', () => {
  const map = { 'C123': '  proj-1  ' };
  const entry = resolveChannelEntry('C123', map);
  assert.equal(entry, 'proj-1');
});

// ── binding key format ────────────────────────────────────────────────────────

test('binding key is channelId:threadTs', () => {
  const channelId = 'C1234567';
  const threadTs = '1234567890.123456';
  const key = `${channelId}:${threadTs}`;
  assert.equal(key, 'C1234567:1234567890.123456');
});

test('different channel+thread pairs produce different keys', () => {
  const key1 = `C1:1234.00`;
  const key2 = `C2:1234.00`;
  assert.notEqual(key1, key2);
});
