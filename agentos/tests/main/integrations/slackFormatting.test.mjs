/**
 * Tests for integrations/slackFormatting.ts
 * Functions inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from integrations/slackFormatting.ts ──────────────────────────────

function convertMarkdownToMrkdwn(text) {
  return (
    text
      .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
      .replace(/\*\*(.+?)\*\*/gs, '*$1*')
      .replace(/^[-*_]{3,}\s*$/gm, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
  );
}

function clampSlackText(input, max = 3500) {
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function buildCuratedSlackUpdate(content) {
  const text = content.trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  let currentSection = null;
  const sections = { final: [], summary: [], questions: [] };

  const headingMap = [
    { key: 'final', regex: /^\s*(final\s+update|update)\s*:?\s*$/i },
    { key: 'summary', regex: /^\s*summary\s*:?\s*$/i },
    { key: 'questions', regex: /^\s*questions?\s*:?\s*$/i },
  ];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = headingMap.find((item) => item.regex.test(line.trim()));
    if (heading) {
      currentSection = heading.key;
      continue;
    }
    if (!currentSection) continue;
    if (!line.trim()) {
      sections[currentSection].push('');
      continue;
    }
    sections[currentSection].push(line);
  }

  const parts = [];
  if (sections.final.join('').trim()) parts.push(`Final Update:\n${sections.final.join('\n').trim()}`);
  if (sections.summary.join('').trim()) parts.push(`Summary:\n${sections.summary.join('\n').trim()}`);
  if (sections.questions.join('').trim()) parts.push(`Questions:\n${sections.questions.join('\n').trim()}`);
  if (parts.length === 0) return null;
  return clampSlackText(parts.join('\n\n'));
}

// ── convertMarkdownToMrkdwn ───────────────────────────────────────────────────

test('convertMarkdownToMrkdwn: h1 heading becomes bold', () => {
  assert.equal(convertMarkdownToMrkdwn('# Hello'), '*Hello*');
});

test('convertMarkdownToMrkdwn: h3 heading becomes bold', () => {
  assert.equal(convertMarkdownToMrkdwn('### Section Title'), '*Section Title*');
});

test('convertMarkdownToMrkdwn: bold ** becomes single *', () => {
  assert.equal(convertMarkdownToMrkdwn('**bold text**'), '*bold text*');
});

test('convertMarkdownToMrkdwn: horizontal rule removed', () => {
  assert.equal(convertMarkdownToMrkdwn('---').trim(), '');
  assert.equal(convertMarkdownToMrkdwn('***').trim(), '');
  assert.equal(convertMarkdownToMrkdwn('___').trim(), '');
});

test('convertMarkdownToMrkdwn: markdown link becomes slack link', () => {
  assert.equal(convertMarkdownToMrkdwn('[click here](https://example.com)'), '<https://example.com|click here>');
});

test('convertMarkdownToMrkdwn: plain text passes through unchanged', () => {
  assert.equal(convertMarkdownToMrkdwn('no markdown here'), 'no markdown here');
});

test('convertMarkdownToMrkdwn: multiline with headings and bold', () => {
  const input = '## Title\nSome **bold** text';
  const result = convertMarkdownToMrkdwn(input);
  assert.ok(result.includes('*Title*'));
  assert.ok(result.includes('*bold*'));
});

// ── clampSlackText ────────────────────────────────────────────────────────────

test('clampSlackText: short text unchanged', () => {
  assert.equal(clampSlackText('hello'), 'hello');
});

test('clampSlackText: trims leading/trailing whitespace', () => {
  assert.equal(clampSlackText('  hello  '), 'hello');
});

test('clampSlackText: truncates at max with ellipsis', () => {
  const long = 'a'.repeat(3600);
  const result = clampSlackText(long);
  assert.equal(result.length, 3500);
  assert.ok(result.endsWith('…'));
});

test('clampSlackText: exactly at max not truncated', () => {
  const exactly = 'x'.repeat(3500);
  const result = clampSlackText(exactly);
  assert.equal(result, exactly);
});

test('clampSlackText: custom max respected', () => {
  const result = clampSlackText('hello world', 5);
  assert.equal(result.length, 5);
  assert.ok(result.endsWith('…'));
});

// ── buildCuratedSlackUpdate ───────────────────────────────────────────────────

test('buildCuratedSlackUpdate: empty string returns null', () => {
  assert.equal(buildCuratedSlackUpdate(''), null);
  assert.equal(buildCuratedSlackUpdate('   '), null);
});

test('buildCuratedSlackUpdate: no recognized sections returns null', () => {
  assert.equal(buildCuratedSlackUpdate('just some text without headings'), null);
});

test('buildCuratedSlackUpdate: extracts Final Update section', () => {
  const input = 'Final Update\nDone with the task.';
  const result = buildCuratedSlackUpdate(input);
  assert.notEqual(result, null);
  assert.ok(result.includes('Final Update:'));
  assert.ok(result.includes('Done with the task.'));
});

test('buildCuratedSlackUpdate: extracts Summary section', () => {
  const input = 'Summary\nThis is a summary.';
  const result = buildCuratedSlackUpdate(input);
  assert.notEqual(result, null);
  assert.ok(result.includes('Summary:'));
  assert.ok(result.includes('This is a summary.'));
});

test('buildCuratedSlackUpdate: extracts Questions section', () => {
  const input = 'Questions\nShould we proceed?';
  const result = buildCuratedSlackUpdate(input);
  assert.notEqual(result, null);
  assert.ok(result.includes('Questions:'));
  assert.ok(result.includes('Should we proceed?'));
});

test('buildCuratedSlackUpdate: multiple sections joined with double newline', () => {
  const input = 'Final Update\nCompleted.\n\nSummary\nBrief summary.';
  const result = buildCuratedSlackUpdate(input);
  assert.notEqual(result, null);
  assert.ok(result.includes('Final Update:'));
  assert.ok(result.includes('Summary:'));
});

test('buildCuratedSlackUpdate: Update heading alias works', () => {
  const input = 'Update\nTask is done.';
  const result = buildCuratedSlackUpdate(input);
  assert.notEqual(result, null);
  assert.ok(result.includes('Final Update:'));
});

test('buildCuratedSlackUpdate: section with only whitespace lines returns null', () => {
  const input = 'Summary\n   \n   ';
  assert.equal(buildCuratedSlackUpdate(input), null);
});
