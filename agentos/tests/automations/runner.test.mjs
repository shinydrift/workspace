/**
 * Tests for automations/runner.ts — pure logic inlined:
 * - resolveSlackChannelForProject
 * - sendNotification (channel resolution and text)
 * - waitForAssistantResponse (event-based accumulation)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Inlined from runner.ts ────────────────────────────────────────────────────

function resolveSlackChannelForProject(projectId, settings, projects) {
  const slack = settings.slack;
  if (!slack?.enabled) return null;

  const map = slack.channelWorkspaceMap ?? {};
  const project = projects[projectId];

  for (const [channelId, mapping] of Object.entries(map)) {
    if (mapping === `project:${projectId}`) return channelId;
    if (project && mapping === project.path) return channelId;
  }

  return null;
}

// Mirror of the notification text logic from sendNotification
function buildNotificationText(job, status) {
  return status === 'completed' ? `✅ *${job.name}* completed` : `❌ *${job.name}* failed`;
}

// Inlined waitForAssistantResponse logic using a passed-in bus
function waitForAssistantResponse(bus, threadId, signal) {
  return new Promise((resolve) => {
    let lastText = '';

    function cleanup() {
      bus.off('message:appended', handler);
    }

    function handler(payload) {
      if (payload.threadId !== threadId) return;
      if (payload.message.role !== 'assistant') return;
      const content = payload.message.content;
      lastText = typeof content === 'string' ? content : JSON.stringify(content);
    }

    signal?.addEventListener(
      'abort',
      () => {
        cleanup();
        resolve(lastText);
      },
      { once: true }
    );

    bus.on('message:appended', handler);
  });
}

// ── resolveSlackChannelForProject ─────────────────────────────────────────────

test('returns null when slack disabled', () => {
  const settings = { slack: { enabled: false, channelWorkspaceMap: { C123: 'project:p1' } } };
  assert.equal(resolveSlackChannelForProject('p1', settings, {}), null);
});

test('returns null when slack not configured', () => {
  const settings = {};
  assert.equal(resolveSlackChannelForProject('p1', settings, {}), null);
});

test('resolves channel by project: prefix', () => {
  const settings = {
    slack: {
      enabled: true,
      channelWorkspaceMap: { C123: 'project:my-project', C456: 'project:other' },
    },
  };
  assert.equal(resolveSlackChannelForProject('my-project', settings, {}), 'C123');
});

test('resolves channel by project path', () => {
  const settings = {
    slack: { enabled: true, channelWorkspaceMap: { C789: '/home/user/myrepo' } },
  };
  const projects = { p2: { path: '/home/user/myrepo', name: 'My Repo' } };
  assert.equal(resolveSlackChannelForProject('p2', settings, projects), 'C789');
});

test('returns null when no mapping matches', () => {
  const settings = {
    slack: { enabled: true, channelWorkspaceMap: { C999: 'project:other' } },
  };
  assert.equal(resolveSlackChannelForProject('p1', settings, {}), null);
});

// ── buildNotificationText ─────────────────────────────────────────────────────

test('completed notification has checkmark', () => {
  const job = { name: 'Daily Sync' };
  assert.equal(buildNotificationText(job, 'completed'), '✅ *Daily Sync* completed');
});

test('failed notification has cross', () => {
  const job = { name: 'Nightly Build' };
  assert.equal(buildNotificationText(job, 'failed'), '❌ *Nightly Build* failed');
});

// ── waitForAssistantResponse ──────────────────────────────────────────────────

test('resolves with last assistant message on abort', async () => {
  const bus = new EventEmitter();
  const controller = new AbortController();

  const responsePromise = waitForAssistantResponse(bus, 'thread-1', controller.signal);

  bus.emit('message:appended', { threadId: 'thread-1', message: { role: 'assistant', content: 'Hello' } });
  bus.emit('message:appended', { threadId: 'thread-1', message: { role: 'assistant', content: 'World' } });

  controller.abort();
  const result = await responsePromise;
  assert.equal(result, 'World');
});

test('ignores messages from other threads', async () => {
  const bus = new EventEmitter();
  const controller = new AbortController();

  const responsePromise = waitForAssistantResponse(bus, 'thread-1', controller.signal);

  bus.emit('message:appended', { threadId: 'thread-2', message: { role: 'assistant', content: 'Other thread' } });
  bus.emit('message:appended', { threadId: 'thread-1', message: { role: 'assistant', content: 'Mine' } });

  controller.abort();
  const result = await responsePromise;
  assert.equal(result, 'Mine');
});

test('ignores non-assistant messages', async () => {
  const bus = new EventEmitter();
  const controller = new AbortController();

  const responsePromise = waitForAssistantResponse(bus, 'thread-1', controller.signal);

  bus.emit('message:appended', { threadId: 'thread-1', message: { role: 'user', content: 'User msg' } });
  bus.emit('message:appended', { threadId: 'thread-1', message: { role: 'tool', content: 'Tool result' } });

  controller.abort();
  const result = await responsePromise;
  assert.equal(result, '');
});

test('resolves with empty string when no messages before abort', async () => {
  const bus = new EventEmitter();
  const controller = new AbortController();

  const responsePromise = waitForAssistantResponse(bus, 'thread-1', controller.signal);
  controller.abort();
  const result = await responsePromise;
  assert.equal(result, '');
});

test('non-string content is JSON-stringified', async () => {
  const bus = new EventEmitter();
  const controller = new AbortController();

  const responsePromise = waitForAssistantResponse(bus, 'thread-1', controller.signal);

  const content = [{ type: 'text', text: 'hello' }];
  bus.emit('message:appended', { threadId: 'thread-1', message: { role: 'assistant', content } });

  controller.abort();
  const result = await responsePromise;
  assert.equal(result, JSON.stringify(content));
});

