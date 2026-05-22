/**
 * Tests for renderer/components/chat/messageUtils.ts
 * Functions inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from messageUtils.ts ──────────────────────────────────────────────

function toolGroupTitle(tools) {
  function primaryArg(input) {
    if (!input || typeof input !== 'object') return '';
    const a = input;
    if (typeof a.description === 'string') return a.description;
    if (typeof a.prompt === 'string') return a.prompt.length > 50 ? a.prompt.slice(0, 50) + '…' : a.prompt;
    if (typeof a.file_path === 'string') return a.file_path.split('/').pop() ?? a.file_path;
    if (typeof a.path === 'string') return a.path.split('/').pop() ?? a.path;
    if (typeof a.command === 'string') return a.command.length > 50 ? a.command.slice(0, 50) + '…' : a.command;
    if (typeof a.pattern === 'string') return a.pattern;
    if (typeof a.query === 'string') return a.query;
    if (typeof a.url === 'string') return a.url;
    return '';
  }
  function displayName(name) {
    const l = name.toLowerCase();
    if (l === 'agent' || l === 'task') return 'Task';
    return name;
  }
  if (tools.length === 1) {
    const { use } = tools[0];
    const arg = primaryArg(use.input);
    const dn = displayName(use.name);
    return arg ? `${dn} · ${arg}` : dn;
  }
  const counts = new Map();
  for (const t of tools) {
    const dn = displayName(t.use.name);
    counts.set(dn, (counts.get(dn) ?? 0) + 1);
  }
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
}

function buildSections(blocks) {
  const resultMap = new Map();
  for (const b of blocks) {
    if (b.type === 'tool_result') resultMap.set(b.toolUseId, b);
  }

  const paired = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      paired.push({ kind: 'text', block: b });
    } else if (b.type === 'thinking') {
      paired.push({ kind: 'thinking', block: b });
    } else if (b.type === 'tool_use') {
      const result = resultMap.get(b.id);
      if (result) resultMap.delete(b.id);
      paired.push({ kind: 'tool', pair: { use: b, result } });
    }
  }

  const raw = [];
  let accum = [];
  const flush = () => {
    if (accum.length > 0) {
      raw.push({ kind: 'tool_group', tools: accum, title: '' });
      accum = [];
    }
  };
  for (const item of paired) {
    if (item.kind === 'tool') {
      accum.push(item.pair);
    } else if (item.kind === 'text') {
      flush();
      raw.push({ kind: 'text', block: item.block });
    } else {
      flush();
      raw.push({ kind: 'thinking', block: item.block });
    }
  }
  flush();

  for (const s of raw) {
    if (s.kind === 'tool_group') s.title = toolGroupTitle(s.tools);
  }

  return raw;
}

function hydrateMissingToolResults(blocks, rawPayload) {
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  const hasToolResult = blocks.some((b) => b.type === 'tool_result');
  if (!hasToolUse || hasToolResult) return blocks;
  if (!Array.isArray(rawPayload)) return blocks;

  const results = [];
  for (const candidate of rawPayload) {
    if (!candidate || typeof candidate !== 'object') continue;
    const top = candidate;
    const event =
      top.type === 'stream_event' && top.event && typeof top.event === 'object' ? top.event : top;
    if (event.type === 'tool_result') {
      const toolUseId = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
      if (!toolUseId) continue;
      const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content ?? '');
      const isError = typeof event.is_error === 'boolean' ? event.is_error : undefined;
      results.push({ type: 'tool_result', toolUseId, content, isError });
    } else if (event.type === 'user') {
      const msgContent =
        event.message && typeof event.message === 'object' ? event.message.content : null;
      if (!Array.isArray(msgContent)) continue;
      for (const item of msgContent) {
        if (!item || typeof item !== 'object') continue;
        const it = item;
        if (it.type !== 'tool_result') continue;
        const toolUseId = typeof it.tool_use_id === 'string' ? it.tool_use_id : '';
        if (!toolUseId) continue;
        const content = typeof it.content === 'string' ? it.content : JSON.stringify(it.content ?? '');
        const isError = typeof it.is_error === 'boolean' ? it.is_error : undefined;
        results.push({ type: 'tool_result', toolUseId, content, isError });
      }
    }
  }

  if (results.length === 0) return blocks;
  return [...blocks, ...results];
}

// ── buildSections ─────────────────────────────────────────────────────────────

test('buildSections: empty blocks returns empty array', () => {
  assert.deepEqual(buildSections([]), []);
});

test('buildSections: single text block', () => {
  const blocks = [{ type: 'text', text: 'hello' }];
  const sections = buildSections(blocks);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'text');
});

test('buildSections: single thinking block', () => {
  const blocks = [{ type: 'thinking', thinking: 'hmm' }];
  const sections = buildSections(blocks);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'thinking');
});

test('buildSections: tool_use with matching tool_result grouped', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/foo/bar.ts' } },
    { type: 'tool_result', toolUseId: 'tu1', content: 'file content' },
  ];
  const sections = buildSections(blocks);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'tool_group');
  assert.equal(sections[0].tools[0].result.content, 'file content');
});

test('buildSections: consecutive tool_uses grouped together', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'tu2', name: 'Grep', input: {} },
    { type: 'tool_result', toolUseId: 'tu1', content: '' },
    { type: 'tool_result', toolUseId: 'tu2', content: '' },
  ];
  const sections = buildSections(blocks);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'tool_group');
  assert.equal(sections[0].tools.length, 2);
});

test('buildSections: text between tools creates separate sections', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
    { type: 'text', text: 'result' },
    { type: 'tool_use', id: 'tu2', name: 'Grep', input: {} },
  ];
  const sections = buildSections(blocks);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].kind, 'tool_group');
  assert.equal(sections[1].kind, 'text');
  assert.equal(sections[2].kind, 'tool_group');
});

test('buildSections: tool_group title for single tool with file_path', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/foo/bar.ts' } }];
  const sections = buildSections(blocks);
  assert.ok(sections[0].title.includes('bar.ts'));
});

test('buildSections: tool_group title for multiple distinct tools', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'tu2', name: 'Grep', input: {} },
  ];
  const sections = buildSections(blocks);
  assert.ok(sections[0].title.includes('Read'));
  assert.ok(sections[0].title.includes('Grep'));
});

test('buildSections: agent/task displayName', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'agent', input: { description: 'do stuff' } }];
  const sections = buildSections(blocks);
  assert.ok(sections[0].title.startsWith('Task'));
});

test('buildSections: tool_group title counts duplicates', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'tu2', name: 'Read', input: {} },
  ];
  const sections = buildSections(blocks);
  assert.ok(sections[0].title.includes('×2'));
});

// ── hydrateMissingToolResults ─────────────────────────────────────────────────

test('hydrateMissingToolResults: no tool_use returns blocks unchanged', () => {
  const blocks = [{ type: 'text', text: 'hi' }];
  assert.equal(hydrateMissingToolResults(blocks, []), blocks);
});

test('hydrateMissingToolResults: already has tool_result returns blocks unchanged', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
    { type: 'tool_result', toolUseId: 'tu1', content: 'x' },
  ];
  assert.equal(hydrateMissingToolResults(blocks, []), blocks);
});

test('hydrateMissingToolResults: non-array payload returns blocks unchanged', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  assert.equal(hydrateMissingToolResults(blocks, null), blocks);
});

test('hydrateMissingToolResults: appends tool_result from direct event', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file data' }];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result.length, 2);
  assert.equal(result[1].type, 'tool_result');
  assert.equal(result[1].toolUseId, 'tu1');
  assert.equal(result[1].content, 'file data');
});

test('hydrateMissingToolResults: appends tool_result from user event (Claude Code CLI format)', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [
    {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'nested content' }],
      },
    },
  ];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result.length, 2);
  assert.equal(result[1].toolUseId, 'tu1');
  assert.equal(result[1].content, 'nested content');
});

test('hydrateMissingToolResults: stream_event wrapper is unwrapped', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [
    {
      type: 'stream_event',
      event: { type: 'tool_result', tool_use_id: 'tu1', content: 'wrapped' },
    },
  ];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result.length, 2);
  assert.equal(result[1].content, 'wrapped');
});

test('hydrateMissingToolResults: is_error propagated', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [{ type: 'tool_result', tool_use_id: 'tu1', content: 'err', is_error: true }];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result[1].isError, true);
});

test('hydrateMissingToolResults: empty payload returns original blocks', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const result = hydrateMissingToolResults(blocks, []);
  assert.equal(result, blocks);
});

test('hydrateMissingToolResults: object content is JSON.stringify-ed', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [{ type: 'tool_result', tool_use_id: 'tu1', content: { ok: true } }];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result[1].content, JSON.stringify({ ok: true }));
});

test('hydrateMissingToolResults: missing tool_use_id is skipped', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [{ type: 'tool_result', content: 'no id' }];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result, blocks);
});

test('hydrateMissingToolResults: non-object candidate is skipped', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [null, 'string', { type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result.length, 2);
  assert.equal(result[1].content, 'ok');
});

test('hydrateMissingToolResults: user event with non-array content is skipped', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const payload = [{ type: 'user', message: { content: 'not-array' } }];
  const result = hydrateMissingToolResults(blocks, payload);
  assert.equal(result, blocks);
});

// ── toolGroupTitle gaps ────────────────────────────────────────────────────────

test('toolGroupTitle: single tool with path arg uses basename', () => {
  const tools = [{ use: { name: 'Glob', input: { path: '/foo/bar/dir' } } }];
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'Glob', input: { path: '/foo/bar/dir' } }]);
  assert.ok(sections[0].title.includes('dir'));
});

test('toolGroupTitle: single tool with short command', () => {
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls -la' } }]);
  assert.ok(sections[0].title.includes('ls -la'));
});

test('toolGroupTitle: single tool with long command truncated', () => {
  const long = 'a'.repeat(60);
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: long } }]);
  assert.ok(sections[0].title.includes('…'));
});

test('toolGroupTitle: single tool with pattern', () => {
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'Glob', input: { pattern: '**/*.ts' } }]);
  assert.ok(sections[0].title.includes('**/*.ts'));
});

test('toolGroupTitle: single tool with query', () => {
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'Grep', input: { query: 'search term' } }]);
  assert.ok(sections[0].title.includes('search term'));
});

test('toolGroupTitle: single tool with url', () => {
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'Fetch', input: { url: 'https://example.com' } }]);
  assert.ok(sections[0].title.includes('example.com'));
});

test('toolGroupTitle: single tool with no known arg returns just tool name', () => {
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'MyTool', input: { unknown: 'val' } }]);
  assert.equal(sections[0].title, 'MyTool');
});

test('toolGroupTitle: single tool with null input returns just tool name', () => {
  const sections = buildSections([{ type: 'tool_use', id: 'x', name: 'MyTool', input: null }]);
  assert.equal(sections[0].title, 'MyTool');
});

test('toolGroupTitle: task displayName applied in multi-tool count', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'agent', input: {} },
    { type: 'tool_use', id: 'tu2', name: 'task', input: {} },
  ];
  const sections = buildSections(blocks);
  assert.ok(sections[0].title.includes('Task ×2'));
});

// ── buildSections edge cases ──────────────────────────────────────────────────

test('buildSections: tool_use without matching result has undefined result', () => {
  const blocks = [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }];
  const sections = buildSections(blocks);
  assert.equal(sections[0].kind, 'tool_group');
  assert.equal(sections[0].tools[0].result, undefined);
});

test('buildSections: thinking between tool_uses flushes each group', () => {
  const blocks = [
    { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
    { type: 'thinking', thinking: 'hmm' },
    { type: 'tool_use', id: 'tu2', name: 'Grep', input: {} },
  ];
  const sections = buildSections(blocks);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].kind, 'tool_group');
  assert.equal(sections[1].kind, 'thinking');
  assert.equal(sections[2].kind, 'tool_group');
});
