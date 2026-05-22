/**
 * Tests for ipc/handlers/wikiHandlers.ts — serialize and parse pure functions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from wikiHandlers.ts ──────────────────────────────────────────────

function serialize(page) {
  return `---\nid: ${page.id}\ntitle: ${page.title}\ncreatedAt: ${page.createdAt}\nupdatedAt: ${page.updatedAt}\n---\n\n${page.content}`;
}

function parse(raw, fallback) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (match) {
    const [, frontmatter, content] = match;
    const fields = {};
    for (const line of frontmatter.split('\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    const id = fields['id'];
    const title = fields['title'];
    const createdAt = Number(fields['createdAt']);
    const updatedAt = Number(fields['updatedAt']);
    if (!id || !title || !createdAt || !updatedAt) return null;
    return { id, title, content, createdAt, updatedAt };
  }

  if (!fallback) return null;
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  const title = headingMatch ? headingMatch[1].trim() : fallback.id;
  const ts = Math.round(fallback.mtimeMs);
  return { id: fallback.id, title, content: raw, createdAt: ts, updatedAt: ts };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePage(overrides = {}) {
  return {
    id: 'page-001',
    title: 'My Page',
    content: 'Hello world',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  };
}

// ── serialize ─────────────────────────────────────────────────────────────────

test('serialize produces YAML frontmatter block', () => {
  const out = serialize(makePage());
  assert.ok(out.startsWith('---\n'));
  assert.ok(out.includes('\n---\n'));
});

test('serialize includes all required fields in frontmatter', () => {
  const page = makePage();
  const out = serialize(page);
  assert.ok(out.includes(`id: ${page.id}`));
  assert.ok(out.includes(`title: ${page.title}`));
  assert.ok(out.includes(`createdAt: ${page.createdAt}`));
  assert.ok(out.includes(`updatedAt: ${page.updatedAt}`));
});

test('serialize places content after frontmatter separator', () => {
  const page = makePage({ content: 'Some content here' });
  const out = serialize(page);
  const afterSep = out.split('---\n\n')[1];
  assert.equal(afterSep, 'Some content here');
});

test('serialize handles empty content', () => {
  const out = serialize(makePage({ content: '' }));
  assert.ok(out.endsWith('---\n\n'));
});

test('serialize handles multi-line content', () => {
  const page = makePage({ content: 'line1\nline2\nline3' });
  const out = serialize(page);
  assert.ok(out.includes('line1\nline2\nline3'));
});

// ── parse — with frontmatter ──────────────────────────────────────────────────

test('parse round-trips a serialized page', () => {
  const page = makePage();
  const result = parse(serialize(page));
  assert.equal(result.id, page.id);
  assert.equal(result.title, page.title);
  assert.equal(result.createdAt, page.createdAt);
  assert.equal(result.updatedAt, page.updatedAt);
  assert.equal(result.content, page.content);
});

test('parse returns null for missing id', () => {
  const raw = `---\ntitle: Test\ncreatedAt: 1700000000000\nupdatedAt: 1700000001000\n---\n\nContent`;
  assert.equal(parse(raw), null);
});

test('parse returns null for missing title', () => {
  const raw = `---\nid: p1\ncreatedAt: 1700000000000\nupdatedAt: 1700000001000\n---\n\nContent`;
  assert.equal(parse(raw), null);
});

test('parse returns null for zero createdAt', () => {
  const raw = `---\nid: p1\ntitle: T\ncreatedAt: 0\nupdatedAt: 1700000001000\n---\n\nContent`;
  assert.equal(parse(raw), null);
});

test('parse returns null for zero updatedAt', () => {
  const raw = `---\nid: p1\ntitle: T\ncreatedAt: 1700000000000\nupdatedAt: 0\n---\n\nContent`;
  assert.equal(parse(raw), null);
});

test('parse handles content with colons correctly', () => {
  const page = makePage({ content: 'key: value\nanother: line' });
  const result = parse(serialize(page));
  assert.equal(result.content, 'key: value\nanother: line');
});

test('parse trims whitespace around frontmatter keys and values', () => {
  const raw = `---\n id : page-001 \n title : My Page \n createdAt : 1700000000000 \n updatedAt : 1700000001000 \n---\n\nContent`;
  const result = parse(raw);
  assert.equal(result.id, 'page-001');
  assert.equal(result.title, 'My Page');
  assert.equal(result.createdAt, 1700000000000);
});

test('parse handles empty content after frontmatter', () => {
  const raw = `---\nid: p1\ntitle: T\ncreatedAt: 1700000000000\nupdatedAt: 1700000001000\n---\n\n`;
  const result = parse(raw);
  assert.equal(result.content, '');
});

// ── parse — plain markdown fallback ──────────────────────────────────────────

test('parse extracts title from h1 heading when no frontmatter', () => {
  const raw = '# My Title\n\nSome content';
  const result = parse(raw, { id: 'file-id', mtimeMs: 1700000000500 });
  assert.equal(result.title, 'My Title');
  assert.equal(result.id, 'file-id');
});

test('parse falls back to id as title when no h1 heading', () => {
  const raw = 'Just some plain text\nno heading here';
  const result = parse(raw, { id: 'fallback-id', mtimeMs: 1700000000000 });
  assert.equal(result.title, 'fallback-id');
});

test('parse uses rounded mtime for createdAt and updatedAt in fallback', () => {
  const raw = '# Title\nContent';
  const result = parse(raw, { id: 'x', mtimeMs: 1700000000123.7 });
  assert.equal(result.createdAt, 1700000000124);
  assert.equal(result.updatedAt, 1700000000124);
});

test('parse returns null for plain markdown with no fallback', () => {
  const raw = '# Title\nContent';
  assert.equal(parse(raw), null);
});

test('parse preserves full raw content for plain markdown pages', () => {
  const raw = '# Title\n\nParagraph one.\n\nParagraph two.';
  const result = parse(raw, { id: 'x', mtimeMs: 1700000000000 });
  assert.equal(result.content, raw);
});
