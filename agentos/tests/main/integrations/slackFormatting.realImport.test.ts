/**
 * Real-import tests for integrations/slackFormatting.ts.
 *
 * Replaces the older inlined `.mjs` mirror (which drifted — its clampSlackText default was 3500 vs
 * the real 39000, and it still tested the now-deleted buildCuratedSlackUpdate). The module is pure
 * with no dependencies, so it imports cleanly and these assertions run against the real converter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { convertMarkdownToMrkdwn, clampSlackText } from '../../../src/main/integrations/slackFormatting';

// ── convertMarkdownToMrkdwn ───────────────────────────────────────────────────

test('convertMarkdownToMrkdwn: headings become bold', () => {
  assert.equal(convertMarkdownToMrkdwn('# Hello'), '*Hello*');
  assert.equal(convertMarkdownToMrkdwn('### Section Title'), '*Section Title*');
});

test('convertMarkdownToMrkdwn: bold ** becomes single *', () => {
  assert.equal(convertMarkdownToMrkdwn('**bold text**'), '*bold text*');
});

test('convertMarkdownToMrkdwn: strikethrough ~~ becomes single ~', () => {
  assert.equal(convertMarkdownToMrkdwn('~~gone~~'), '~gone~');
});

test('convertMarkdownToMrkdwn: horizontal rules removed', () => {
  assert.equal(convertMarkdownToMrkdwn('---').trim(), '');
  assert.equal(convertMarkdownToMrkdwn('***').trim(), '');
  assert.equal(convertMarkdownToMrkdwn('___').trim(), '');
});

test('convertMarkdownToMrkdwn: bullets normalize to •', () => {
  assert.equal(convertMarkdownToMrkdwn('- one\n* two'), '• one\n• two');
  // Indentation is preserved.
  assert.equal(convertMarkdownToMrkdwn('  - nested'), '  • nested');
});

test('convertMarkdownToMrkdwn: bold marker is not mistaken for a bullet', () => {
  assert.equal(convertMarkdownToMrkdwn('**bold**'), '*bold*');
});

test('convertMarkdownToMrkdwn: link becomes slack link', () => {
  assert.equal(convertMarkdownToMrkdwn('[click here](https://example.com)'), '<https://example.com|click here>');
});

test('convertMarkdownToMrkdwn: image drops the leading !', () => {
  assert.equal(convertMarkdownToMrkdwn('![alt](https://img.png)'), '<https://img.png|alt>');
  assert.equal(convertMarkdownToMrkdwn('![](https://img.png)'), '<https://img.png>');
});

test('convertMarkdownToMrkdwn: code fence language is stripped', () => {
  assert.equal(convertMarkdownToMrkdwn('```ts\ncode\n```'), '```\ncode\n```');
});

test('convertMarkdownToMrkdwn: GFM table becomes a code-fenced aligned grid', () => {
  const input = ['| Name | Qty |', '|------|-----|', '| Apple | 3 |', '| Fig | 12 |'].join('\n');
  const result = convertMarkdownToMrkdwn(input);
  assert.ok(result.startsWith('```\n') && result.endsWith('\n```'), 'wrapped in a code fence');
  assert.ok(!result.includes('---'), 'separator row dropped');
  assert.ok(result.includes('Name  | Qty'), 'columns padded to width');
  assert.ok(result.includes('Apple | 3'));
});

test('convertMarkdownToMrkdwn: non-table text with pipes is left alone', () => {
  const input = 'a | b\nc | d';
  assert.equal(convertMarkdownToMrkdwn(input), input);
});

test('convertMarkdownToMrkdwn: plain text passes through unchanged', () => {
  assert.equal(convertMarkdownToMrkdwn('no markdown here'), 'no markdown here');
});

// ── clampSlackText ────────────────────────────────────────────────────────────

test('clampSlackText: short text unchanged', () => {
  assert.equal(clampSlackText('hello'), 'hello');
});

test('clampSlackText: trims leading/trailing whitespace', () => {
  assert.equal(clampSlackText('  hello  '), 'hello');
});

test('clampSlackText: truncates at custom max with ellipsis', () => {
  const result = clampSlackText('hello world', 5);
  assert.equal(result.length, 5);
  assert.ok(result.endsWith('…'));
});

test('clampSlackText: exactly at max not truncated', () => {
  const exactly = 'x'.repeat(20);
  assert.equal(clampSlackText(exactly, 20), exactly);
});
