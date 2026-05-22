/**
 * Functional tests for memory/session-files.ts.
 * buildSessionEntry reads real JSONL files, so we use a temp file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ── Inlined from session-files.ts ─────────────────────────────────────────────

function extractText(content) {
  if (typeof content === 'string') return content.replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text ?? '').replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function buildSessionEntry(absPath, threadId) {
  if (!fs.existsSync(absPath)) return null;
  const stat = fs.statSync(absPath);
  let raw;
  try { raw = fs.readFileSync(absPath, 'utf8'); } catch { return null; }
  const lines = raw.split('\n');
  const contentLines = [];
  const lineMap = [];
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const role = msg.role;
    if (role !== 'user' && role !== 'assistant') return;
    const text = extractText(msg.content);
    if (!text) return;
    const label = role === 'user' ? 'User' : 'Assistant';
    contentLines.push(`${label}: ${text}`);
    lineMap.push(idx + 1);
  });
  if (contentLines.length === 0) return null;
  const content = contentLines.join('\n');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return { path: `sessions/${threadId}.jsonl`, absPath, mtimeMs: stat.mtimeMs, size: stat.size, hash, content, lineMap };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeTmpJsonl(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-session-test-'));
  const filePath = path.join(dir, 'thread1.jsonl');
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'));
  return { filePath, dir };
}

// ── extractText ───────────────────────────────────────────────────────────────

test('extractText string content collapses newlines', () => {
  assert.equal(extractText('hello\n  world'), 'hello world');
});

test('extractText array content joins text blocks', () => {
  const content = [
    { type: 'text', text: 'hello' },
    { type: 'text', text: 'world' },
  ];
  assert.equal(extractText(content), 'hello world');
});

test('extractText array filters non-text blocks', () => {
  const content = [
    { type: 'tool_use', id: 'x', name: 'bash', input: {} },
    { type: 'text', text: 'actual text' },
  ];
  assert.equal(extractText(content), 'actual text');
});

test('extractText returns empty string for empty array', () => {
  assert.equal(extractText([]), '');
});

test('extractText returns empty string for non-string non-array', () => {
  assert.equal(extractText(42), '');
  assert.equal(extractText(null), '');
});

// ── buildSessionEntry ─────────────────────────────────────────────────────────

test('buildSessionEntry returns null for missing file', () => {
  assert.equal(buildSessionEntry('/nonexistent/path.jsonl', 'x'), null);
});

test('buildSessionEntry returns null for file with no user/assistant messages', () => {
  const { filePath, dir } = writeTmpJsonl([
    { role: 'system', content: 'You are helpful.' },
    { role: 'tool', content: 'tool result' },
  ]);
  try {
    assert.equal(buildSessionEntry(filePath, 'thread1'), null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildSessionEntry returns null for file with no text content', () => {
  const { filePath, dir } = writeTmpJsonl([
    { role: 'user', content: [{ type: 'tool_use', id: 'x' }] },
  ]);
  try {
    assert.equal(buildSessionEntry(filePath, 'thread1'), null);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildSessionEntry builds correct entry from simple messages', () => {
  const { filePath, dir } = writeTmpJsonl([
    { role: 'user', content: 'Hello there' },
    { role: 'assistant', content: 'Hi back' },
  ]);
  try {
    const entry = buildSessionEntry(filePath, 'thread1');
    assert.ok(entry !== null);
    assert.equal(entry.path, 'sessions/thread1.jsonl');
    assert.equal(entry.absPath, filePath);
    assert.ok(entry.content.includes('User: Hello there'));
    assert.ok(entry.content.includes('Assistant: Hi back'));
    assert.equal(entry.lineMap.length, 2);
    assert.equal(entry.lineMap[0], 1); // first JSONL line (1-indexed)
    assert.equal(entry.lineMap[1], 2);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildSessionEntry skips malformed JSON lines gracefully', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-session-test-'));
  const filePath = path.join(dir, 'thread1.jsonl');
  fs.writeFileSync(filePath, [
    JSON.stringify({ role: 'user', content: 'good message' }),
    'not valid json {{{',
    JSON.stringify({ role: 'assistant', content: 'good reply' }),
  ].join('\n'));
  try {
    const entry = buildSessionEntry(filePath, 'thread1');
    assert.ok(entry !== null);
    assert.ok(entry.content.includes('User: good message'));
    assert.ok(entry.content.includes('Assistant: good reply'));
    assert.equal(entry.lineMap.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildSessionEntry content hash is stable (deterministic)', () => {
  const { filePath, dir } = writeTmpJsonl([
    { role: 'user', content: 'test message' },
  ]);
  try {
    const a = buildSessionEntry(filePath, 'thread1');
    const b = buildSessionEntry(filePath, 'thread1');
    assert.equal(a?.hash, b?.hash);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildSessionEntry array content extracts only text blocks', () => {
  const { filePath, dir } = writeTmpJsonl([
    { role: 'user', content: [
      { type: 'tool_use', id: 'tool1', name: 'bash', input: { command: 'ls' } },
      { type: 'text', text: 'what files exist?' },
    ]},
  ]);
  try {
    const entry = buildSessionEntry(filePath, 'thread1');
    assert.ok(entry !== null);
    assert.ok(entry.content.includes('what files exist?'));
    assert.ok(!entry.content.includes('bash'));
    assert.ok(!entry.content.includes('tool_use'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('buildSessionEntry skips blank lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-session-test-'));
  const filePath = path.join(dir, 'thread1.jsonl');
  fs.writeFileSync(filePath, [
    JSON.stringify({ role: 'user', content: 'hello' }),
    '',
    '   ',
    JSON.stringify({ role: 'assistant', content: 'world' }),
  ].join('\n'));
  try {
    const entry = buildSessionEntry(filePath, 'thread1');
    assert.equal(entry?.lineMap.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
