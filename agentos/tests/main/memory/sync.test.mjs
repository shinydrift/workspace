/**
 * Tests for memory/sync.ts — hashText and listMarkdownFiles.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Inlined from sync.ts ─────────────────────────────────────────────────────

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function listMarkdownFiles(rootDir) {
  const results = [];
  const recurse = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) recurse(full);
      else if (name.endsWith('.md')) results.push(full);
    }
  };
  recurse(rootDir);
  return results;
}

// ── hashText ──────────────────────────────────────────────────────────────────

test('hashText returns 16-character hex string', () => {
  const hash = hashText('hello');
  assert.equal(hash.length, 16);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test('hashText is deterministic', () => {
  assert.equal(hashText('same input'), hashText('same input'));
});

test('hashText differs for different inputs', () => {
  assert.notEqual(hashText('input A'), hashText('input B'));
});

test('hashText of empty string is stable 16-char hex', () => {
  const hash = hashText('');
  assert.equal(hash.length, 16);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test('hashText handles unicode input', () => {
  const hash = hashText('こんにちは');
  assert.equal(hash.length, 16);
});

test('hashText handles large input', () => {
  const hash = hashText('x'.repeat(100_000));
  assert.equal(hash.length, 16);
});

// ── listMarkdownFiles ─────────────────────────────────────────────────────────

test('listMarkdownFiles returns empty array for missing directory', () => {
  const results = listMarkdownFiles('/no/such/dir/at/all');
  assert.deepEqual(results, []);
});

test('listMarkdownFiles finds .md files in root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sync-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory');
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes');
    const results = listMarkdownFiles(dir);
    assert.equal(results.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listMarkdownFiles ignores non-.md files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sync-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory');
    fs.writeFileSync(path.join(dir, 'config.json'), '{}');
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'text');
    const results = listMarkdownFiles(dir);
    assert.equal(results.length, 1);
    assert.ok(results[0].endsWith('MEMORY.md'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listMarkdownFiles recurses into subdirectories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sync-test-'));
  try {
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(dir, 'a.md'), '# A');
    fs.writeFileSync(path.join(sub, 'b.md'), '# B');
    const results = listMarkdownFiles(dir);
    assert.equal(results.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listMarkdownFiles returns absolute paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sync-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory');
    const results = listMarkdownFiles(dir);
    assert.ok(path.isAbsolute(results[0]));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listMarkdownFiles deeply nested files are found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sync-test-'));
  try {
    const deep = path.join(dir, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'deep.md'), '# Deep');
    const results = listMarkdownFiles(dir);
    assert.equal(results.length, 1);
    assert.ok(results[0].includes('deep.md'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listMarkdownFiles empty directory returns empty array', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-sync-test-'));
  try {
    const results = listMarkdownFiles(dir);
    assert.deepEqual(results, []);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
