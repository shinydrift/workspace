/**
 * Tests for integrations/slackCatchupService.ts — logic inlined per repo convention.
 *
 * Covers: updateChannelCursor timestamp arithmetic and dedup,
 *         mapSlackApiMessage field mapping and type coercion,
 *         sweepMessages pagination and ordering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── updateChannelCursor ───────────────────────────────────────────────────────
// Inlined from SlackCatchupService.updateChannelCursor

function nextCursor(ts) {
  const [secs, frac = ''] = ts.split('.');
  const micro = BigInt(secs) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6)) + 1n;
  return `${(micro / 1_000_000n).toString()}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
}

function updateChannelCursor(store, channelId, ts) {
  const cursors = store.get('slackChannelCursors') ?? {};
  const existing = cursors[channelId];
  const next = nextCursor(ts);
  if (!existing || next > existing) {
    store.set('slackChannelCursors', { ...cursors, [channelId]: next });
  }
}

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    _data: data,
  };
}

test('updateChannelCursor: increments fractional part by 1 microsecond', () => {
  const store = makeStore();
  updateChannelCursor(store, 'C1', '1700000000.000001');
  const cursors = store.get('slackChannelCursors');
  assert.equal(cursors['C1'], '1700000000.000002');
});

test('updateChannelCursor: wraps microseconds into next second', () => {
  const store = makeStore();
  updateChannelCursor(store, 'C1', '1700000000.999999');
  const cursors = store.get('slackChannelCursors');
  assert.equal(cursors['C1'], '1700000001.000000');
});

test('updateChannelCursor: handles ts without fractional part', () => {
  const store = makeStore();
  updateChannelCursor(store, 'C1', '1700000000');
  const cursors = store.get('slackChannelCursors');
  assert.equal(cursors['C1'], '1700000000.000001');
});

test('updateChannelCursor: short fractional part padded correctly', () => {
  const store = makeStore();
  updateChannelCursor(store, 'C1', '1700000000.1');
  // frac='1' padded to '100000', so 100000+1=100001 → '1700000000.100001'
  const cursors = store.get('slackChannelCursors');
  assert.equal(cursors['C1'], '1700000000.100001');
});

test('updateChannelCursor: does not overwrite if existing cursor is already ahead', () => {
  const store = makeStore({ slackChannelCursors: { C1: '1700000099.000000' } });
  updateChannelCursor(store, 'C1', '1700000000.000001');
  assert.equal(store.get('slackChannelCursors')['C1'], '1700000099.000000');
});

test('updateChannelCursor: overwrites if new cursor is strictly greater', () => {
  const store = makeStore({ slackChannelCursors: { C1: '1700000000.000001' } });
  updateChannelCursor(store, 'C1', '1700000000.000002');
  assert.equal(store.get('slackChannelCursors')['C1'], '1700000000.000003');
});

test('updateChannelCursor: preserves other channels', () => {
  const store = makeStore({ slackChannelCursors: { C2: '1600000000.000000' } });
  updateChannelCursor(store, 'C1', '1700000000.000001');
  const cursors = store.get('slackChannelCursors');
  assert.equal(cursors['C2'], '1600000000.000000');
  assert.ok('C1' in cursors);
});

// ── mapSlackApiMessage ────────────────────────────────────────────────────────
// Inlined from SlackCatchupService.mapSlackApiMessage (private)

function mapSlackApiMessage(msg, channelId, overrideThreadTs) {
  const m = msg;
  return {
    type: typeof m.type === 'string' ? m.type : undefined,
    ts: typeof m.ts === 'string' ? m.ts : undefined,
    text: typeof m.text === 'string' ? m.text : undefined,
    user: typeof m.user === 'string' ? m.user : undefined,
    bot_id: typeof m.bot_id === 'string' ? m.bot_id : undefined,
    subtype: typeof m.subtype === 'string' ? m.subtype : undefined,
    thread_ts: overrideThreadTs ?? (typeof m.thread_ts === 'string' ? m.thread_ts : undefined),
    channel: channelId,
    files: Array.isArray(m.files) ? m.files : undefined,
  };
}

test('mapSlackApiMessage: maps all string fields correctly', () => {
  const msg = {
    type: 'message',
    ts: '1700000000.000001',
    text: 'hello',
    user: 'U123',
    bot_id: 'B456',
    subtype: 'bot_message',
    thread_ts: '1700000000.000000',
    files: [{ id: 'F1' }],
  };
  const result = mapSlackApiMessage(msg, 'C1', undefined);
  assert.equal(result.type, 'message');
  assert.equal(result.ts, '1700000000.000001');
  assert.equal(result.text, 'hello');
  assert.equal(result.user, 'U123');
  assert.equal(result.bot_id, 'B456');
  assert.equal(result.subtype, 'bot_message');
  assert.equal(result.thread_ts, '1700000000.000000');
  assert.equal(result.channel, 'C1');
  assert.deepEqual(result.files, [{ id: 'F1' }]);
});

test('mapSlackApiMessage: overrideThreadTs replaces msg.thread_ts', () => {
  const msg = { type: 'message', ts: '1700000000.000001', thread_ts: '1700000000.000000' };
  const result = mapSlackApiMessage(msg, 'C1', '1699000000.000000');
  assert.equal(result.thread_ts, '1699000000.000000');
});

test('mapSlackApiMessage: non-string fields coerced to undefined', () => {
  const msg = { type: 42, ts: null, text: true, user: {}, bot_id: [], subtype: 0, thread_ts: false };
  const result = mapSlackApiMessage(msg, 'C1', undefined);
  assert.equal(result.type, undefined);
  assert.equal(result.ts, undefined);
  assert.equal(result.text, undefined);
  assert.equal(result.user, undefined);
  assert.equal(result.bot_id, undefined);
  assert.equal(result.subtype, undefined);
  assert.equal(result.thread_ts, undefined);
});

test('mapSlackApiMessage: non-array files coerced to undefined', () => {
  const result = mapSlackApiMessage({ files: 'not-an-array' }, 'C1', undefined);
  assert.equal(result.files, undefined);
});

test('mapSlackApiMessage: channel is always set from argument', () => {
  const result = mapSlackApiMessage({}, 'CXYZ', undefined);
  assert.equal(result.channel, 'CXYZ');
});

// ── sweepMessages ─────────────────────────────────────────────────────────────
// Inlined sweep logic

async function sweepMessages(fetcher, channelId, dispatchInboundSlackEvent, overrideThreadTs, skipTs) {
  let cursor;
  do {
    const result = await fetcher(cursor);
    for (const msg of (result.messages ?? []).slice().reverse()) {
      const m = msg;
      if (!m.ts || m.type !== 'message') continue;
      if (skipTs && m.ts === skipTs) continue;
      await dispatchInboundSlackEvent(mapSlackApiMessage(msg, channelId, overrideThreadTs));
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

test('sweepMessages: dispatches messages in reverse order', async () => {
  const dispatched = [];
  const messages = [
    { ts: '1700000001.000000', type: 'message', text: 'first' },
    { ts: '1700000002.000000', type: 'message', text: 'second' },
    { ts: '1700000003.000000', type: 'message', text: 'third' },
  ];
  const fetcher = async () => ({ messages });
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e.text); }, undefined, undefined);
  // slice().reverse() reverses the array, so third is dispatched first
  assert.deepEqual(dispatched, ['third', 'second', 'first']);
});

test('sweepMessages: skips non-message type events', async () => {
  const dispatched = [];
  const messages = [
    { ts: '1.0', type: 'message', text: 'ok' },
    { ts: '2.0', type: 'app_mention', text: 'skip' },
  ];
  const fetcher = async () => ({ messages });
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e.text); }, undefined, undefined);
  assert.deepEqual(dispatched, ['ok']);
});

test('sweepMessages: skips messages without ts', async () => {
  const dispatched = [];
  const messages = [
    { type: 'message', text: 'no ts' },
    { ts: '1.0', type: 'message', text: 'has ts' },
  ];
  const fetcher = async () => ({ messages });
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e.text); }, undefined, undefined);
  assert.deepEqual(dispatched, ['has ts']);
});

test('sweepMessages: skips message matching skipTs', async () => {
  const dispatched = [];
  const messages = [
    { ts: '1.0', type: 'message', text: 'keep' },
    { ts: '2.0', type: 'message', text: 'skip-me' },
  ];
  const fetcher = async () => ({ messages });
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e.text); }, undefined, '2.0');
  assert.deepEqual(dispatched, ['keep']);
});

test('sweepMessages: follows pagination cursor until empty', async () => {
  const dispatched = [];
  let page = 0;
  const pages = [
    { messages: [{ ts: '1.0', type: 'message', text: 'p1' }], response_metadata: { next_cursor: 'cursor1' } },
    { messages: [{ ts: '2.0', type: 'message', text: 'p2' }], response_metadata: { next_cursor: '' } },
  ];
  const fetcher = async (cursor) => {
    return pages[page++];
  };
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e.text); }, undefined, undefined);
  assert.deepEqual(dispatched, ['p1', 'p2']);
});

test('sweepMessages: empty messages list dispatches nothing', async () => {
  const dispatched = [];
  const fetcher = async () => ({ messages: [] });
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e); }, undefined, undefined);
  assert.equal(dispatched.length, 0);
});

test('sweepMessages: missing messages field dispatches nothing', async () => {
  const dispatched = [];
  const fetcher = async () => ({});
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e); }, undefined, undefined);
  assert.equal(dispatched.length, 0);
});

test('sweepMessages: overrideThreadTs forwarded to mapped event', async () => {
  const dispatched = [];
  const messages = [{ ts: '1.0', type: 'message', thread_ts: 'orig' }];
  const fetcher = async () => ({ messages });
  await sweepMessages(fetcher, 'C1', (e) => { dispatched.push(e); }, 'override_ts', undefined);
  assert.equal(dispatched[0].thread_ts, 'override_ts');
});
