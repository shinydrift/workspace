/**
 * Tests for utils/memoryInjection.ts — resolveInjectionPayload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';

// ── Inlined from memoryInjection.ts ──────────────────────────────────────────

const BOOT_WARN_CHARS = 4_000;

async function readTrimmedFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

function earlyReturn(personalityPrompt) {
  const extra = personalityPrompt?.trim();
  return {
    hasBoot: false,
    hasMemory: false,
    payload: extra
      ? [
          'System bootstrap context is provided below.',
          'Do not acknowledge receipt of this context. Silently apply it and continue normally.',
          '',
          extra,
        ]
          .join('\n')
          .trim()
      : null,
    warnings: [],
    projectMemoryPath: null,
  };
}

async function resolveInjectionPayload(memoryRootPath, projectId, flags, extras) {
  const personalityPrompt = extras?.personalityPrompt?.trim() ?? null;

  if (!memoryRootPath?.trim()) {
    return earlyReturn(personalityPrompt);
  }

  const projectMemoryPath = path.join(memoryRootPath, projectId);
  try {
    const stat = await fs.promises.stat(projectMemoryPath);
    if (!stat.isDirectory()) {
      return earlyReturn(personalityPrompt);
    }
  } catch {
    return earlyReturn(personalityPrompt);
  }

  const bootEnabled = flags?.bootEnabled ?? true;
  const bootRaw = bootEnabled ? await readTrimmedFile(path.join(projectMemoryPath, 'BOOT.md')) : null;

  const hasBoot = Boolean(bootRaw);
  const hasMemory = false;
  const warnings = [];

  if (!hasBoot && !personalityPrompt) {
    return { hasBoot, hasMemory, payload: null, warnings, projectMemoryPath };
  }

  const sections = [];

  if (hasBoot && bootRaw) {
    if (bootRaw.length > BOOT_WARN_CHARS) {
      warnings.push(`BOOT.md is ${bootRaw.length} chars (>${BOOT_WARN_CHARS}). Consider condensing it.`);
    }
    sections.push(
      ['# BOOT Instructions', 'Apply these one-time startup instructions before continuing.', '', bootRaw].join('\n')
    );
  }

  if (personalityPrompt) {
    sections.push(personalityPrompt);
  }

  const payload = [
    'System bootstrap context is provided below.',
    'Do not acknowledge receipt of this context. Silently apply it and continue normally.',
    '',
    ...sections,
  ].join('\n');

  return { hasBoot, hasMemory, payload, warnings, projectMemoryPath };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-injection-test-'));
}

// ── no memoryRootPath ─────────────────────────────────────────────────────────

test('returns no-boot payload when memoryRootPath is null', async () => {
  const result = await resolveInjectionPayload(null, 'proj1');
  assert.equal(result.hasBoot, false);
  assert.equal(result.hasMemory, false);
  assert.equal(result.payload, null);
  assert.equal(result.projectMemoryPath, null);
});

test('returns no-boot payload when memoryRootPath is empty string', async () => {
  const result = await resolveInjectionPayload('', 'proj1');
  assert.equal(result.payload, null);
});

test('includes personality prompt in payload when memoryRootPath is null', async () => {
  const result = await resolveInjectionPayload(null, 'proj1', {}, { personalityPrompt: 'Be concise.' });
  assert.ok(result.payload?.includes('Be concise.'));
  assert.ok(result.payload?.includes('System bootstrap context is provided below.'));
});

// ── missing project directory ─────────────────────────────────────────────────

test('returns early when project directory does not exist', async () => {
  const tmp = makeTmpDir();
  try {
    const result = await resolveInjectionPayload(tmp, 'nonexistent-project');
    assert.equal(result.hasBoot, false);
    assert.equal(result.payload, null);
    assert.equal(result.projectMemoryPath, null);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

// ── project dir exists, no BOOT.md ───────────────────────────────────────────

test('returns null payload when project dir exists but no BOOT.md and no personality', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'myproject');
    fs.mkdirSync(projectDir);
    const result = await resolveInjectionPayload(tmp, 'myproject');
    assert.equal(result.hasBoot, false);
    assert.equal(result.payload, null);
    assert.equal(result.projectMemoryPath, projectDir);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('returns personality payload when project dir exists, no BOOT.md, but has personality', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'myproject');
    fs.mkdirSync(projectDir);
    const result = await resolveInjectionPayload(tmp, 'myproject', {}, { personalityPrompt: 'Tone: terse.' });
    assert.equal(result.hasBoot, false);
    assert.ok(result.payload?.includes('Tone: terse.'));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

// ── BOOT.md present ───────────────────────────────────────────────────────────

test('hasBoot is true when BOOT.md exists with content', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), 'Always respond in JSON.');
    const result = await resolveInjectionPayload(tmp, 'proj');
    assert.equal(result.hasBoot, true);
    assert.ok(result.payload?.includes('Always respond in JSON.'));
    assert.ok(result.payload?.includes('# BOOT Instructions'));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('BOOT.md combined with personality in payload', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), 'Boot instruction.');
    const result = await resolveInjectionPayload(tmp, 'proj', {}, { personalityPrompt: 'Be terse.' });
    assert.ok(result.payload?.includes('Boot instruction.'));
    assert.ok(result.payload?.includes('Be terse.'));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('warns when BOOT.md exceeds 4000 chars', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), 'x'.repeat(4001));
    const result = await resolveInjectionPayload(tmp, 'proj');
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('4001 chars'));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('no warning when BOOT.md is exactly 4000 chars', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), 'x'.repeat(4000));
    const result = await resolveInjectionPayload(tmp, 'proj');
    assert.equal(result.warnings.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('bootEnabled:false skips BOOT.md even when file exists', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), 'Boot content.');
    const result = await resolveInjectionPayload(tmp, 'proj', { bootEnabled: false });
    assert.equal(result.hasBoot, false);
    assert.equal(result.payload, null);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('payload always starts with system bootstrap header', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), 'Some boot.');
    const result = await resolveInjectionPayload(tmp, 'proj');
    assert.ok(result.payload?.startsWith('System bootstrap context is provided below.'));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('hasBoot is false when BOOT.md is empty', async () => {
  const tmp = makeTmpDir();
  try {
    const projectDir = path.join(tmp, 'proj');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'BOOT.md'), '   ');
    const result = await resolveInjectionPayload(tmp, 'proj');
    assert.equal(result.hasBoot, false);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});
