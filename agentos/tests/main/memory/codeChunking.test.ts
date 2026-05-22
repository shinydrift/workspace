import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { splitCodeBySymbols } from '../../../src/main/memory/codeChunking';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('splitCodeBySymbols: unknown extension returns empty', async () => {
  const chunks = await splitCodeBySymbols('hello world', 'foo.txt');
  assert.deepEqual(chunks, []);
});

test('splitCodeBySymbols: simple TypeScript function produces chunks', async () => {
  const content = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
  const chunks = await splitCodeBySymbols(content, 'add.ts');
  assert.ok(chunks.length > 0, 'expected at least one chunk');
  assert.ok(chunks[0].text.includes('add'), 'chunk should contain function name');
});

test('splitCodeBySymbols: small adjacent top-level nodes are merged into one chunk', async () => {
  const content = ['export const A = 1;', 'export const B = 2;', 'export function foo() { return 3; }'].join('\n');
  const chunks = await splitCodeBySymbols(content, 'multi.ts');
  assert.equal(chunks.length, 1, `expected 1 merged chunk, got ${chunks.length}`);
  assert.ok(chunks[0].text.includes('A') && chunks[0].text.includes('B') && chunks[0].text.includes('foo'));
});

test('splitCodeBySymbols: nodes that together exceed limit start a new chunk', async () => {
  // Two nodes each ~800 chars — together exceed MEMORY_SECTION_MAX_CHARS (1400)
  const big = 'x'.repeat(750);
  const content = [`export const A = '${big}';`, `export const B = '${big}';`].join('\n');
  const chunks = await splitCodeBySymbols(content, 'big.ts');
  assert.equal(chunks.length, 2, `expected 2 chunks for overflow, got ${chunks.length}`);
});

test('splitCodeBySymbols: small nodes flanking an oversized node each get separate chunks', async () => {
  const small1 = 'export const A = 1;';
  // Function body well over MEMORY_SECTION_MAX_CHARS so it hits chunkNode recursion
  const oversized = `export function big() { const x = '${'x'.repeat(2000)}'; }`;
  const small2 = 'export const B = 2;';
  const content = [small1, oversized, small2].join('\n');
  const chunks = await splitCodeBySymbols(content, 'mixed.ts');
  // small1 flushed before oversized; oversized split by chunkNode (≥1 chunk); small2 in its own group
  assert.ok(chunks.length >= 3, `expected >= 3 chunks, got ${chunks.length}`);
  assert.ok(chunks.some((c) => c.text.includes('A')), 'chunk for A missing');
  assert.ok(chunks.some((c) => c.text.includes('big')), 'chunk for big() missing');
  assert.ok(chunks.some((c) => c.text.includes('B')), 'chunk for B missing');
});

test('splitCodeBySymbols: tiny function signature is merged into body chunk, not emitted alone', async () => {
  // A function with a short name whose body is oversized. The name + params form a tiny
  // prefix group — they should be prepended to the first body chunk, not emitted as a 6-char standalone.
  const oversized = `export function big() { const x = '${'x'.repeat(2000)}'; }`;
  const chunks = await splitCodeBySymbols(oversized, 'fn.ts');
  // 'big' must appear somewhere
  assert.ok(chunks.some((c) => c.text.includes('big')), 'function name not in any chunk');
  // No chunk should be just the tiny signature alone (e.g. "big\n()")
  const tinyOnly = chunks.find((c) => c.text.trim() === 'big' || c.text.trim() === 'big\n()');
  assert.ok(!tinyOnly, `tiny standalone signature chunk found: ${JSON.stringify(tinyOnly?.text)}`);
});

test('splitCodeBySymbols: small children of an oversized node are grouped, not emitted individually', async () => {
  // An oversized object with 10 small properties + 1 huge property.
  // Before fix: each small property was emitted as its own single-line chunk.
  // After fix: adjacent small properties should be merged into one chunk.
  const props = Array.from({ length: 10 }, (_, i) => `  prop${i}: 'value${i}',`).join('\n');
  const content = `export const config = {\n${props}\n  longProp: '${'x'.repeat(1500)}',\n};`;
  const chunks = await splitCodeBySymbols(content, 'config.ts');
  // All 10 small props should appear together in a single chunk (not 10 separate chunks)
  const allTogether = chunks.some((c) => c.text.includes('prop0') && c.text.includes('prop9'));
  assert.ok(allTogether, `small props not grouped; chunks: ${chunks.map((c) => c.text.slice(0, 50)).join(' | ')}`);
  // No individual small property should be its own lone chunk
  const loneProp = chunks.find((c) => /^\s*prop\d: 'value\d',\s*$/.test(c.text));
  assert.ok(!loneProp, `lone property chunk found: ${JSON.stringify(loneProp?.text)}`);
});

test('splitCodeBySymbols: runs on a real workspace .ts file', async (t) => {
  const filePath = path.resolve(__dirname, '../../../src/main/memory/codeChunking.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  const chunks = await splitCodeBySymbols(content, filePath);
  assert.ok(chunks.length > 0, `expected chunks from codeChunking.ts, got 0`);
  for (const chunk of chunks) {
    assert.ok(typeof chunk.text === 'string' && chunk.text.length > 0);
    assert.ok(typeof chunk.startLine === 'number');
    assert.ok(typeof chunk.endLine === 'number');
  }
  t.diagnostic(`codeChunking.ts → ${chunks.length} chunks`);
});

test('splitCodeBySymbols: runs on sync.ts', async (t) => {
  const filePath = path.resolve(__dirname, '../../../src/main/memory/sync.ts');
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const chunks = await splitCodeBySymbols(content, filePath);
  assert.ok(chunks.length > 0, `expected chunks from sync.ts, got 0`);
  t.diagnostic(`sync.ts → ${chunks.length} chunks`);
});
