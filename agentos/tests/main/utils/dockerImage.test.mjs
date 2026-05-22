/**
 * Tests for utils/docker/image.ts — parseSemver + imageBinaryVersionAtLeast (inlined).
 * No Docker calls made.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from image.ts ─────────────────────────────────────────────────────

function parseSemver(input) {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverAtLeast(currentStr, minStr) {
  const currentParsed = currentStr ? parseSemver(currentStr) : null;
  const minParsed = parseSemver(minStr);
  if (!currentParsed || !minParsed) return false;
  if (currentParsed[0] !== minParsed[0]) return currentParsed[0] > minParsed[0];
  if (currentParsed[1] !== minParsed[1]) return currentParsed[1] > minParsed[1];
  return currentParsed[2] >= minParsed[2];
}

// ── parseSemver ───────────────────────────────────────────────────────────────

test('parseSemver: parses standard version string', () => {
  assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3]);
});

test('parseSemver: parses version with leading text', () => {
  assert.deepEqual(parseSemver('codex 0.107.0'), [0, 107, 0]);
});

test('parseSemver: parses version with v prefix', () => {
  assert.deepEqual(parseSemver('v2.10.5'), [2, 10, 5]);
});

test('parseSemver: returns null for empty string', () => {
  assert.equal(parseSemver(''), null);
});

test('parseSemver: returns null for no version pattern', () => {
  assert.equal(parseSemver('no version here'), null);
});

test('parseSemver: parses first match in multi-version string', () => {
  assert.deepEqual(parseSemver('1.2.3 (built with 4.5.6)'), [1, 2, 3]);
});

test('parseSemver: handles large version numbers', () => {
  assert.deepEqual(parseSemver('100.200.300'), [100, 200, 300]);
});

test('parseSemver: handles zero patch version', () => {
  assert.deepEqual(parseSemver('0.107.0'), [0, 107, 0]);
});

// ── semverAtLeast (imageBinaryVersionAtLeast logic) ───────────────────────────

test('semverAtLeast: same version returns true', () => {
  assert.equal(semverAtLeast('1.2.3', '1.2.3'), true);
});

test('semverAtLeast: higher patch returns true', () => {
  assert.equal(semverAtLeast('1.2.4', '1.2.3'), true);
});

test('semverAtLeast: lower patch returns false', () => {
  assert.equal(semverAtLeast('1.2.2', '1.2.3'), false);
});

test('semverAtLeast: higher minor returns true regardless of patch', () => {
  assert.equal(semverAtLeast('1.3.0', '1.2.9'), true);
});

test('semverAtLeast: lower minor returns false regardless of patch', () => {
  assert.equal(semverAtLeast('1.1.9', '1.2.0'), false);
});

test('semverAtLeast: higher major returns true', () => {
  assert.equal(semverAtLeast('2.0.0', '1.99.99'), true);
});

test('semverAtLeast: lower major returns false', () => {
  assert.equal(semverAtLeast('1.99.99', '2.0.0'), false);
});

test('semverAtLeast: null current returns false', () => {
  assert.equal(semverAtLeast(null, '1.0.0'), false);
});

test('semverAtLeast: unparseable current returns false', () => {
  assert.equal(semverAtLeast('not-a-version', '1.0.0'), false);
});

test('semverAtLeast: unparseable min returns false', () => {
  assert.equal(semverAtLeast('1.0.0', 'not-a-version'), false);
});

test('semverAtLeast: MIN_CODEX_CLI_VERSION boundary — exact match passes', () => {
  // MIN_CODEX_CLI_VERSION = '0.107.0'
  assert.equal(semverAtLeast('0.107.0', '0.107.0'), true);
});

test('semverAtLeast: one below MIN_CODEX_CLI_VERSION fails', () => {
  assert.equal(semverAtLeast('0.106.9', '0.107.0'), false);
});

test('semverAtLeast: one above MIN_CODEX_CLI_VERSION passes', () => {
  assert.equal(semverAtLeast('0.108.0', '0.107.0'), true);
});

test('semverAtLeast: version embedded in output string', () => {
  assert.equal(semverAtLeast('codex 0.107.1 (some build info)', '0.107.0'), true);
});
