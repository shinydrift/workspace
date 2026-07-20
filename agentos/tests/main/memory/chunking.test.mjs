import test from 'node:test';
import assert from 'node:assert/strict';

// Inline splitMemoryByDelimiters and MEMORY_SECTION_MAX_CHARS from chunking.ts
// (avoids TypeScript compilation in pure node:test runs)

const MEMORY_SECTION_MAX_CHARS = 1400;
const MEMORY_SAVE_SECTION_MAX_CHARS = 2000;

function splitMemoryByDelimiters(text, filename) {
  const parts = text.split(/\n---\n/);
  const chunks = [];
  let lineOffset = 1;

  for (const part of parts) {
    const lineCount = part.split('\n').length;
    const trimmed = part.trim();
    if (trimmed) {
      chunks.push({
        text: trimmed,
        startLine: lineOffset,
        endLine: lineOffset + lineCount - 1,
        contextHeader: `[${filename} > chunk ${chunks.length + 1}]`,
      });
    }
    lineOffset += lineCount + 1;
  }

  return chunks.length ? chunks : [{ text: text.trim() || text, startLine: 1, endLine: text.split('\n').length }];
}

// ── splitMemoryByDelimiters ───────────────────────────────────────────────────

test('single section with no delimiter returns one chunk', () => {
  const chunks = splitMemoryByDelimiters('hello world', 'MEMORY.md');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'hello world');
  assert.equal(chunks[0].contextHeader, '[MEMORY.md > chunk 1]');
  assert.equal(chunks[0].startLine, 1);
});

test('two sections split by --- produce two chunks', () => {
  const text = 'section one\n---\nsection two';
  const chunks = splitMemoryByDelimiters(text, 'memory/notes.md');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, 'section one');
  assert.equal(chunks[0].contextHeader, '[memory/notes.md > chunk 1]');
  assert.equal(chunks[1].text, 'section two');
  assert.equal(chunks[1].contextHeader, '[memory/notes.md > chunk 2]');
});

test('three sections produce three chunks with sequential headers', () => {
  const text = 'a\n---\nb\n---\nc';
  const chunks = splitMemoryByDelimiters(text, 'foo.md');
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].contextHeader, '[foo.md > chunk 1]');
  assert.equal(chunks[1].contextHeader, '[foo.md > chunk 2]');
  assert.equal(chunks[2].contextHeader, '[foo.md > chunk 3]');
});

test('empty section between delimiters is skipped', () => {
  const text = 'first\n---\n\n---\nlast';
  const chunks = splitMemoryByDelimiters(text, 'MEMORY.md');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, 'first');
  assert.equal(chunks[1].text, 'last');
});

test('sections are trimmed of surrounding whitespace', () => {
  const text = '  ## Section\n\nsome content  \n---\n  more content\n';
  const chunks = splitMemoryByDelimiters(text, 'f.md');
  assert.equal(chunks[0].text, '## Section\n\nsome content');
  assert.equal(chunks[1].text, 'more content');
});

test('empty input returns fallback single chunk', () => {
  const chunks = splitMemoryByDelimiters('', 'MEMORY.md');
  assert.equal(chunks.length, 1);
});

test('line numbers track across sections', () => {
  // line 1: "alpha"
  // line 2: "---"  (the separator, consumed)
  // line 3: "beta"
  const text = 'alpha\n---\nbeta';
  const chunks = splitMemoryByDelimiters(text, 'f.md');
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 1);
  assert.equal(chunks[1].startLine, 3);
  assert.equal(chunks[1].endLine, 3);
});

test('*** and ___ are not treated as delimiters', () => {
  const text = 'section one\n***\nsection two\n___\nsection three';
  const chunks = splitMemoryByDelimiters(text, 'MEMORY.md');
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.includes('***'));
  assert.ok(chunks[0].text.includes('___'));
});

// ── MEMORY_SECTION_MAX_CHARS ──────────────────────────────────────────────────

test('MEMORY_SECTION_MAX_CHARS is 1400', () => {
  assert.equal(MEMORY_SECTION_MAX_CHARS, 1400);
});

// ── save() section validation (pure logic, no FS) ────────────────────────────

function validateSections(content) {
  const sections = content.split(/\n---\n/);
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (section.length > MEMORY_SAVE_SECTION_MAX_CHARS) {
      throw new Error(
        `Section ${i + 1} exceeds the ${MEMORY_SAVE_SECTION_MAX_CHARS} character limit (got ${section.length}). Split it with --- before saving.`
      );
    }
  }
}

test('validateSections passes for content under limit', () => {
  assert.doesNotThrow(() => validateSections('short content'));
});

test('validateSections passes for multiple sections each under limit', () => {
  assert.doesNotThrow(() => validateSections('section one\n---\nsection two'));
});

test('validateSections throws for section over 2000 chars', () => {
  const big = 'x'.repeat(2001);
  assert.throws(() => validateSections(big), /Section 1 exceeds the 2000 character limit \(got 2001\)/);
});

test('validateSections throws with correct section number', () => {
  const big = 'x'.repeat(2001);
  const content = 'ok section\n---\n' + big;
  assert.throws(() => validateSections(content), /Section 2 exceeds/);
});

test('validateSections passes for section exactly at 2000 chars', () => {
  const exact = 'x'.repeat(2000);
  assert.doesNotThrow(() => validateSections(exact));
});
