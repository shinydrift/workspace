/**
 * Tests for integrations/slackRoutingService.ts — SlackRoutingService.processInboundMessage guards.
 * Logic inlined per repo convention.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Source anchor ─────────────────────────────────────────────────────────────

test('SlackRoutingService: production source has expected guards in processInboundMessage', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(dir, '../../src/main/integrations/slackRoutingService.ts'),
    'utf8'
  );
  assert.match(src, /export class SlackRoutingService/);
  assert.match(src, /processInboundMessage/);
  assert.match(src, /bot_id/);
  assert.match(src, /processedMessageKeys/);
  assert.match(src, /defaultWorkingDirectory/);
  assert.match(src, /file_share/);
});

test('SlackRoutingService: reactions are not driven here — only binds lastInboundTs for the echo', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(dir, '../../src/main/integrations/slackRoutingService.ts'), 'utf8');
  // Binds the inbound message so slackBridge.onThreadStatus knows what to react on.
  assert.match(src, /updateBinding\(binding\.key, \{ lastInboundTs: messageTs \}\)/);
  // No reaction calls or emoji literals remain — the status lifecycle owns those now.
  assert.doesNotMatch(src, /addReaction|removeReaction/);
  assert.doesNotMatch(src, /robot_face|white_check_mark/);
});

// ── Inlined guard logic ───────────────────────────────────────────────────────

/**
 * Returns true if the message should be skipped before any processing.
 */
function shouldSkipMessage(message) {
  if ((message.subtype && message.subtype !== 'file_share') || message.bot_id || !message.user) return true;
  const hasFiles = (message.files?.length ?? 0) > 0;
  if (!message.text && !hasFiles) return true;
  return false;
}

/**
 * Returns the stripped task text (@ mention removed).
 */
function extractTask(text) {
  return (text ?? '').trim().replace(/^<@[A-Z0-9]+>\s*/i, '').trim();
}

test('shouldSkipMessage: skips bot messages', () => {
  assert.equal(shouldSkipMessage({ bot_id: 'B123', user: 'U1', text: 'hi' }), true);
});

test('shouldSkipMessage: skips messages without user', () => {
  assert.equal(shouldSkipMessage({ text: 'hi' }), true);
});

test('shouldSkipMessage: skips non-file_share subtype', () => {
  assert.equal(shouldSkipMessage({ subtype: 'message_changed', user: 'U1', text: 'hi' }), true);
});

test('shouldSkipMessage: passes file_share subtype', () => {
  assert.equal(shouldSkipMessage({ subtype: 'file_share', user: 'U1', files: [{ id: 'F1' }] }), false);
});

test('shouldSkipMessage: skips empty text with no files', () => {
  assert.equal(shouldSkipMessage({ user: 'U1', text: '' }), true);
});

test('shouldSkipMessage: skips undefined text with no files', () => {
  assert.equal(shouldSkipMessage({ user: 'U1' }), true);
});

test('shouldSkipMessage: passes message with text and user', () => {
  assert.equal(shouldSkipMessage({ user: 'U1', text: 'do something' }), false);
});

test('shouldSkipMessage: passes message with files even if text is empty', () => {
  assert.equal(shouldSkipMessage({ user: 'U1', text: '', files: [{ id: 'F1' }] }), false);
});

test('shouldSkipMessage: passes message with no subtype', () => {
  assert.equal(shouldSkipMessage({ user: 'U1', text: 'hello' }), false);
});

// ── extractTask ───────────────────────────────────────────────────────────────

test('extractTask: strips @-mention prefix', () => {
  assert.equal(extractTask('<@U12345> do the thing'), 'do the thing');
});

test('extractTask: strips uppercase @-mention', () => {
  assert.equal(extractTask('<@UABC123XYZ> analyze this'), 'analyze this');
});

test('extractTask: returns text unchanged when no @-mention', () => {
  assert.equal(extractTask('plain task text'), 'plain task text');
});

test('extractTask: trims leading/trailing whitespace', () => {
  assert.equal(extractTask('  hello world  '), 'hello world');
});

test('extractTask: returns empty string for undefined', () => {
  assert.equal(extractTask(undefined), '');
});

test('extractTask: returns empty string for empty text after mention', () => {
  assert.equal(extractTask('<@U123>'), '');
});

// ── Dedup key format (source anchor) ─────────────────────────────────────────

test('processInboundMessage: production source builds dedup key as channelId:messageTs', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(dir, '../../src/main/integrations/slackRoutingService.ts'),
    'utf8'
  );
  // Key must combine channelId and message.ts with a colon so different channels/timestamps stay independent.
  assert.match(src, /`\$\{params\.channelId\}:\$\{message\.ts\}`/);
});

// Council/robot emoji selection moved into the shared status lifecycle (deriveThreadReactionEmoji);
// see tests/shared/threadStatusLifecycle.test.ts. Slack no longer picks emoji in executeTask.

// ── Missing workingDirectory guard ───────────────────────────────────────────

async function processWithMissingWorkdir(postMessage) {
  const defaultWorkingDirectory = null;
  if (!defaultWorkingDirectory) {
    await postMessage('C123', 'AgentOS: set Slack default working directory in Settings before sending tasks.', 'ts');
    return 'skipped';
  }
  return 'processed';
}

test('processInboundMessage: posts error and returns when workingDirectory is null', async () => {
  const posts = [];
  const result = await processWithMissingWorkdir((ch, text, ts) => {
    posts.push({ ch, text, ts });
    return Promise.resolve();
  });
  assert.equal(result, 'skipped');
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /set Slack default working directory/);
});
