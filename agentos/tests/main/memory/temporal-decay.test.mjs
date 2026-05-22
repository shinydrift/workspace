/**
 * Functional tests for memory/temporal-decay.ts pure logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Inlined from temporal-decay.ts ───────────────────────────────────────────

const DATED_PATH_RE = /(?:^|\/)memory\/(\d{4})-(\d{2})-(\d{2})\.md$/;

function isEvergreen(relPath) {
  const base = path.basename(relPath).toLowerCase();
  return base === 'memory.md' || base === 'boot.md';
}

function isEvergreenCode(relPath) {
  return /(?:^|\/)(?:node_modules|\.git|vendor|dist|build|\.next|\.nuxt|__generated__|generated)(?:\/|$)/.test(relPath);
}

function calculateMultiplier(ageInDays, halfLifeDays) {
  if (halfLifeDays <= 0 || !Number.isFinite(halfLifeDays)) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * Math.max(0, ageInDays));
}

function resolveTimestampMs(relPath, source, updatedAt, workspaceDir) {
  if (source === 'sessions') return updatedAt > 0 ? updatedAt : null;
  if (source === 'code') return isEvergreenCode(relPath) ? null : updatedAt > 0 ? updatedAt : null;
  if (isEvergreen(relPath)) return null;
  const datedMatch = DATED_PATH_RE.exec(relPath);
  if (datedMatch) {
    const [, year, month, day] = datedMatch;
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (workspaceDir) {
    try {
      const absPath = path.join(workspaceDir, relPath);
      return fs.statSync(absPath).mtimeMs;
    } catch { /* ignore */ }
  }
  return null;
}

const DEFAULT_DECAY_CONFIG = { enabled: true, halfLifeDays: 45 };

function applyDecay(results, config, workspaceDir, nowMs = Date.now()) {
  const cfg = { ...DEFAULT_DECAY_CONFIG, ...config };
  if (!cfg.enabled) return results;
  const minScore = cfg.decayMinScore ?? 0;
  return results.map((result) => {
    if (result.pinned) return result;
    const timestampMs = resolveTimestampMs(result.path, result.source, result.updatedAt, workspaceDir);
    if (timestampMs === null) return result;
    const ageInDays = (nowMs - timestampMs) / 86_400_000;
    const multiplier = calculateMultiplier(ageInDays, cfg.halfLifeDays);
    const decayed = result.score * multiplier;
    const floored = minScore > 0 ? Math.max(minScore, decayed) : decayed;
    return { ...result, score: Number(floored.toFixed(4)) };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-04T00:00:00Z').getTime();
function result(path, source, score, updatedAt = 0) {
  return { path, source, score, updatedAt };
}

// ── calculateMultiplier ───────────────────────────────────────────────────────

test('calculateMultiplier age 0 returns 1 (no decay)', () => {
  assert.equal(calculateMultiplier(0, 45), 1);
});

test('calculateMultiplier age = halfLife returns ~0.5', () => {
  const m = calculateMultiplier(45, 45);
  assert.ok(Math.abs(m - 0.5) < 1e-10, `expected ~0.5, got ${m}`);
});

test('calculateMultiplier age = 2× halfLife returns ~0.25', () => {
  const m = calculateMultiplier(90, 45);
  assert.ok(Math.abs(m - 0.25) < 1e-10, `expected ~0.25, got ${m}`);
});

test('calculateMultiplier returns 1 for invalid halfLife', () => {
  assert.equal(calculateMultiplier(100, 0), 1);
  assert.equal(calculateMultiplier(100, -5), 1);
  assert.equal(calculateMultiplier(100, Infinity), 1);
});

test('calculateMultiplier negative age is clamped to 0', () => {
  assert.equal(calculateMultiplier(-10, 45), 1);
});

// ── isEvergreen ───────────────────────────────────────────────────────────────

test('MEMORY.md is evergreen', () => assert.ok(isEvergreen('MEMORY.md')));
test('memory.md (lowercase) is evergreen', () => assert.ok(isEvergreen('memory.md')));
test('BOOT.md is evergreen', () => assert.ok(isEvergreen('BOOT.md')));
test('memory/2026-05-23.md is not evergreen', () => assert.ok(!isEvergreen('memory/2026-05-23.md')));
test('memory/general.md is not evergreen', () => assert.ok(!isEvergreen('memory/general.md')));

// ── applyDecay — disabled ─────────────────────────────────────────────────────

test('applyDecay with enabled=false returns results unchanged', () => {
  const r = [result('memory/2026-05-23.md', 'memory', 0.9)];
  const out = applyDecay(r, { enabled: false }, null, NOW);
  assert.equal(out[0].score, 0.9);
});

// ── applyDecay — evergreen paths ──────────────────────────────────────────────

test('applyDecay does not decay MEMORY.md', () => {
  const r = [result('MEMORY.md', 'memory', 0.9)];
  const out = applyDecay(r, {}, null, NOW);
  assert.equal(out[0].score, 0.9);
});

test('applyDecay does not decay BOOT.md', () => {
  const r = [result('BOOT.md', 'memory', 0.9)];
  const out = applyDecay(r, {}, null, NOW);
  assert.equal(out[0].score, 0.9);
});

// ── applyDecay — dated memory files ──────────────────────────────────────────

test('applyDecay decays dated file that is exactly one halfLife old', () => {
  // halfLife = 45 days; set file date to 45 days before NOW
  const fileDate = new Date(NOW - 45 * 86_400_000);
  const relPath = `memory/${fileDate.toISOString().slice(0, 10).replace(/-/g, '-')}.md`;
  const r = [result(relPath, 'memory', 1.0)];
  const out = applyDecay(r, { halfLifeDays: 45 }, null, NOW);
  assert.ok(Math.abs(out[0].score - 0.5) < 0.001, `expected ~0.5, got ${out[0].score}`);
});

test('applyDecay applies stronger decay to older dated files', () => {
  const newer = [result('memory/2026-07-04.md', 'memory', 1.0)];
  const older  = [result('memory/2026-05-23.md', 'memory', 1.0)];
  const outNewer = applyDecay(newer, {}, null, NOW);
  const outOlder = applyDecay(older, {}, null, NOW);
  assert.ok(outNewer[0].score > outOlder[0].score, 'newer file should have higher score after decay');
});

// ── applyDecay — session source ───────────────────────────────────────────────

test('applyDecay decays session chunk by updatedAt', () => {
  const updatedAt = NOW - 45 * 86_400_000; // 45 days ago
  const r = [{ path: 'sessions/thread1.jsonl', source: 'sessions', score: 1.0, updatedAt }];
  const out = applyDecay(r, { halfLifeDays: 45 }, null, NOW);
  assert.ok(Math.abs(out[0].score - 0.5) < 0.001);
});

test('applyDecay skips session with updatedAt=0', () => {
  const r = [{ path: 'sessions/thread1.jsonl', source: 'sessions', score: 0.8, updatedAt: 0 }];
  const out = applyDecay(r, {}, null, NOW);
  assert.equal(out[0].score, 0.8);
});

// ── applyDecay — mtime fallback ───────────────────────────────────────────────

test('applyDecay decays memory file via mtime when workspace provided', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-decay-test-'));
  try {
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir);
    const filePath = path.join(memDir, 'notes.md');
    fs.writeFileSync(filePath, 'test content');
    // Back-date mtime to 45 days ago
    const oldTime = new Date(NOW - 45 * 86_400_000);
    fs.utimesSync(filePath, oldTime, oldTime);

    const r = [result('memory/notes.md', 'memory', 1.0)];
    const out = applyDecay(r, { halfLifeDays: 45 }, tmpDir, NOW);
    assert.ok(out[0].score < 0.6, `expected decay via mtime, got ${out[0].score}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('applyDecay skips decay when workspace is null and no date in path', () => {
  const r = [result('memory/notes.md', 'memory', 0.9)];
  const out = applyDecay(r, {}, null, NOW);
  assert.equal(out[0].score, 0.9);
});

// ── isEvergreenCode ───────────────────────────────────────────────────────────

test('isEvergreenCode node_modules path is evergreen', () => assert.ok(isEvergreenCode('node_modules/lodash/index.js')));
test('isEvergreenCode .git path is evergreen', () => assert.ok(isEvergreenCode('.git/config')));
test('isEvergreenCode vendor path is evergreen', () => assert.ok(isEvergreenCode('vendor/somelib/lib.js')));
test('isEvergreenCode dist path is evergreen', () => assert.ok(isEvergreenCode('dist/bundle.js')));
test('isEvergreenCode src path is not evergreen', () => assert.ok(!isEvergreenCode('src/main/foo.ts')));
test('isEvergreenCode root file is not evergreen', () => assert.ok(!isEvergreenCode('index.ts')));

// ── applyDecay — code source ──────────────────────────────────────────────────

test('applyDecay decays code chunk by updatedAt', () => {
  const updatedAt = NOW - 180 * 86_400_000; // 180 days ago
  const r = [{ path: 'src/main/foo.ts', source: 'code', score: 1.0, updatedAt }];
  const out = applyDecay(r, { halfLifeDays: 180 }, null, NOW);
  assert.ok(Math.abs(out[0].score - 0.5) < 0.001, `expected ~0.5, got ${out[0].score}`);
});

test('applyDecay: recent code chunk scores higher than stale chunk', () => {
  const recent = [{ path: 'src/a.ts', source: 'code', score: 1.0, updatedAt: NOW - 10 * 86_400_000 }];
  const stale = [{ path: 'src/b.ts', source: 'code', score: 1.0, updatedAt: NOW - 200 * 86_400_000 }];
  const cfg = { halfLifeDays: 180 };
  const outRecent = applyDecay(recent, cfg, null, NOW);
  const outStale = applyDecay(stale, cfg, null, NOW);
  assert.ok(outRecent[0].score > outStale[0].score, 'recent chunk must score higher');
});

test('applyDecay skips code chunk with updatedAt=0', () => {
  const r = [{ path: 'src/main/foo.ts', source: 'code', score: 0.8, updatedAt: 0 }];
  const out = applyDecay(r, { halfLifeDays: 180 }, null, NOW);
  assert.equal(out[0].score, 0.8);
});

test('applyDecay does not decay node_modules code chunk', () => {
  const updatedAt = NOW - 200 * 86_400_000;
  const r = [{ path: 'node_modules/lodash/index.js', source: 'code', score: 0.9, updatedAt }];
  const out = applyDecay(r, { halfLifeDays: 180 }, null, NOW);
  assert.equal(out[0].score, 0.9);
});

test('applyDecay does not decay pinned code chunk', () => {
  const updatedAt = NOW - 200 * 86_400_000;
  const r = [{ path: 'src/main/foo.ts', source: 'code', score: 0.9, updatedAt, pinned: true }];
  const out = applyDecay(r, { halfLifeDays: 180 }, null, NOW);
  assert.equal(out[0].score, 0.9);
});
