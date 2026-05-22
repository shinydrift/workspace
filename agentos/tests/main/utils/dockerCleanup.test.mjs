/**
 * Tests for utils/dockerCleanup.ts — parseInspectOutput (inlined pure parsing logic).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from dockerCleanup.ts — pure inspect output parsing ───────────────

function parseInspectOutput(stdout) {
  const raw = stdout.trim();
  const [runningRaw = 'false', imageRaw = '', labelsRaw = '{}'] = raw.split('\t');
  let labels = {};
  try {
    labels = JSON.parse(labelsRaw);
  } catch {
    labels = {};
  }
  return {
    exists: true,
    running: runningRaw === 'true',
    image: imageRaw || null,
    labels,
  };
}

// ── running flag ──────────────────────────────────────────────────────────────

test('parseInspectOutput: running=true', () => {
  const result = parseInspectOutput('true\tmy-image:latest\t{"key":"val"}');
  assert.equal(result.running, true);
});

test('parseInspectOutput: running=false', () => {
  const result = parseInspectOutput('false\tmy-image:latest\t{"key":"val"}');
  assert.equal(result.running, false);
});

test('parseInspectOutput: always sets exists=true', () => {
  const result = parseInspectOutput('false\tmy-image\t{}');
  assert.equal(result.exists, true);
});

// ── image field ───────────────────────────────────────────────────────────────

test('parseInspectOutput: image parsed correctly', () => {
  const result = parseInspectOutput('true\tmy-image:1.2.3\t{}');
  assert.equal(result.image, 'my-image:1.2.3');
});

test('parseInspectOutput: empty image returns null', () => {
  const result = parseInspectOutput('false\t\t{}');
  assert.equal(result.image, null);
});

test('parseInspectOutput: missing image tab defaults to null', () => {
  const result = parseInspectOutput('false');
  assert.equal(result.image, null);
});

// ── labels parsing ────────────────────────────────────────────────────────────

test('parseInspectOutput: labels parsed correctly', () => {
  const result = parseInspectOutput('true\timg\t{"agentos.threadId":"abc","agentos.managed":"1"}');
  assert.deepEqual(result.labels, { 'agentos.threadId': 'abc', 'agentos.managed': '1' });
});

test('parseInspectOutput: empty labels object', () => {
  const result = parseInspectOutput('true\timg\t{}');
  assert.deepEqual(result.labels, {});
});

test('parseInspectOutput: malformed labels JSON falls back to empty object', () => {
  const result = parseInspectOutput('true\timg\tnot-json');
  assert.deepEqual(result.labels, {});
});

test('parseInspectOutput: missing labels tab defaults to empty object', () => {
  const result = parseInspectOutput('true\timg');
  assert.deepEqual(result.labels, {});
});

// ── whitespace handling ───────────────────────────────────────────────────────

test('parseInspectOutput: trims surrounding whitespace', () => {
  const result = parseInspectOutput('  true\timg:latest\t{}  \n');
  assert.equal(result.running, true);
  assert.equal(result.image, 'img:latest');
});
