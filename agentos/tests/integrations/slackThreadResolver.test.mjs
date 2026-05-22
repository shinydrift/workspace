/**
 * Tests for integrations/slackThreadResolver.ts — SlackThreadResolver.resolveRootThreadTs.
 * Logic inlined per repo convention.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Source anchor ─────────────────────────────────────────────────────────────

test('SlackThreadResolver: production source exports the class with resolveRootThreadTs', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(dir, '../../src/main/integrations/slackThreadResolver.ts'),
    'utf8'
  );
  assert.match(src, /export class SlackThreadResolver/);
  assert.match(src, /resolveRootThreadTs/);
  assert.match(src, /conversations\.history/);
});

// ── Inlined logic ─────────────────────────────────────────────────────────────

class SlackThreadResolver {
  constructor(getWebClient) {
    this._getWebClient = getWebClient;
  }

  async resolveRootThreadTs(channelId, messageTs, explicitThreadTs) {
    if (explicitThreadTs && explicitThreadTs.trim()) return explicitThreadTs;
    const webClient = this._getWebClient();
    if (!webClient) return messageTs;
    try {
      const result = await webClient.conversations.history({
        channel: channelId,
        oldest: messageTs,
        latest: messageTs,
        inclusive: true,
        limit: 1,
      });
      const hit = result.messages?.find((item) => item.ts === messageTs);
      const maybeThreadTs = typeof hit?.thread_ts === 'string' ? hit.thread_ts : undefined;
      return maybeThreadTs?.trim() ? maybeThreadTs : messageTs;
    } catch {
      return messageTs;
    }
  }
}

test('resolveRootThreadTs: returns explicitThreadTs when provided and non-empty', async () => {
  const resolver = new SlackThreadResolver(() => null);
  const result = await resolver.resolveRootThreadTs('C123', '111.111', '999.999');
  assert.equal(result, '999.999');
});

test('resolveRootThreadTs: returns messageTs when explicitThreadTs is whitespace', async () => {
  const resolver = new SlackThreadResolver(() => null);
  const result = await resolver.resolveRootThreadTs('C123', '111.111', '   ');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns messageTs when explicitThreadTs is empty string', async () => {
  const resolver = new SlackThreadResolver(() => null);
  const result = await resolver.resolveRootThreadTs('C123', '111.111', '');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns messageTs when explicitThreadTs is undefined', async () => {
  const resolver = new SlackThreadResolver(() => null);
  const result = await resolver.resolveRootThreadTs('C123', '111.111', undefined);
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns messageTs when webClient is null', async () => {
  const resolver = new SlackThreadResolver(() => null);
  const result = await resolver.resolveRootThreadTs('C123', '111.111');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns thread_ts from API hit when present', async () => {
  const fakeClient = {
    conversations: {
      history: async ({ channel, oldest }) => ({
        messages: [{ ts: oldest, thread_ts: '100.000' }],
      }),
    },
  };
  const resolver = new SlackThreadResolver(() => fakeClient);
  const result = await resolver.resolveRootThreadTs('C123', '111.111');
  assert.equal(result, '100.000');
});

test('resolveRootThreadTs: returns messageTs when API hit has no thread_ts', async () => {
  const fakeClient = {
    conversations: {
      history: async ({ oldest }) => ({
        messages: [{ ts: oldest }],
      }),
    },
  };
  const resolver = new SlackThreadResolver(() => fakeClient);
  const result = await resolver.resolveRootThreadTs('C123', '111.111');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns messageTs when API hit has whitespace thread_ts', async () => {
  const fakeClient = {
    conversations: {
      history: async ({ oldest }) => ({
        messages: [{ ts: oldest, thread_ts: '   ' }],
      }),
    },
  };
  const resolver = new SlackThreadResolver(() => fakeClient);
  const result = await resolver.resolveRootThreadTs('C123', '111.111');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns messageTs when messages array is empty', async () => {
  const fakeClient = {
    conversations: {
      history: async () => ({ messages: [] }),
    },
  };
  const resolver = new SlackThreadResolver(() => fakeClient);
  const result = await resolver.resolveRootThreadTs('C123', '111.111');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: returns messageTs when API throws', async () => {
  const fakeClient = {
    conversations: {
      history: async () => {
        throw new Error('network error');
      },
    },
  };
  const resolver = new SlackThreadResolver(() => fakeClient);
  const result = await resolver.resolveRootThreadTs('C123', '111.111');
  assert.equal(result, '111.111');
});

test('resolveRootThreadTs: passes correct params to conversations.history', async () => {
  const calls = [];
  const fakeClient = {
    conversations: {
      history: async (params) => {
        calls.push(params);
        return { messages: [] };
      },
    },
  };
  const resolver = new SlackThreadResolver(() => fakeClient);
  await resolver.resolveRootThreadTs('C456', '222.333');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'C456');
  assert.equal(calls[0].oldest, '222.333');
  assert.equal(calls[0].latest, '222.333');
  assert.equal(calls[0].inclusive, true);
  assert.equal(calls[0].limit, 1);
});
