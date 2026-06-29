/**
 * Tests for src/main/config/projectConfig.ts — exercises the REAL source (load / update /
 * ensure / path) against the canonical parser, replacing the previous inlined copy that
 * had drifted from the live schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  getProjectConfigPath,
  loadProjectConfig,
  ensureProjectConfig,
  updateProjectConfig,
  resetProjectConfigCacheForTest,
} from '../../../src/main/config/projectConfig';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-cfg-test-'));
}

test.afterEach(() => resetProjectConfigCacheForTest());

test('getProjectConfigPath appends .agentos/config.json', () => {
  const p = getProjectConfigPath('/home/user/project');
  assert.equal(p, path.join('/home/user/project', '.agentos', 'config.json'));
});

test('loadProjectConfig returns exists:false when file missing', async () => {
  const result = await loadProjectConfig('/no/such/path');
  assert.equal(result.exists, false);
  assert.equal(result.config, null);
});

test('loadProjectConfig returns Invalid JSON warning for malformed file', async () => {
  const dir = tmpProject();
  try {
    fs.mkdirSync(path.join(dir, '.agentos'));
    fs.writeFileSync(path.join(dir, '.agentos', 'config.json'), 'not json');
    const result = await loadProjectConfig(dir);
    assert.equal(result.exists, true);
    assert.ok(result.warnings.includes('Invalid JSON'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('loadProjectConfig parses a valid config file', async () => {
  const dir = tmpProject();
  try {
    fs.mkdirSync(path.join(dir, '.agentos'));
    fs.writeFileSync(
      path.join(dir, '.agentos', 'config.json'),
      JSON.stringify({ version: 1, memory: { enabled: false }, agents: { providerOrder: ['gemini'] } })
    );
    const result = await loadProjectConfig(dir);
    assert.equal(result.exists, true);
    assert.equal(result.config?.memory?.enabled, false);
    assert.equal(result.config?.agents?.providerOrder?.[0]?.provider, 'gemini');
    assert.equal(result.warnings.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('loadProjectConfig warns-and-ignores unknown top-level keys', async () => {
  const dir = tmpProject();
  try {
    fs.mkdirSync(path.join(dir, '.agentos'));
    fs.writeFileSync(path.join(dir, '.agentos', 'config.json'), JSON.stringify({ provider: 'claude', bogus: 1 }));
    const result = await loadProjectConfig(dir);
    assert.ok(result.warnings.some((w) => w.includes('provider')));
    assert.ok(result.warnings.some((w) => w.includes('bogus')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('ensureProjectConfig creates a default template config', async () => {
  const dir = tmpProject();
  try {
    const { created, lookup } = await ensureProjectConfig(dir);
    assert.equal(created, true);
    assert.equal(lookup.exists, true);
    assert.equal(lookup.config?.version, 1);
    assert.equal(lookup.config?.worktree?.autoCreate, false);
    // Second call is a no-op create.
    const second = await ensureProjectConfig(dir);
    assert.equal(second.created, false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateProjectConfig creates and merges into a top-level key', async () => {
  const dir = tmpProject();
  try {
    await updateProjectConfig(dir, 'memory', { enabled: false });
    let result = await loadProjectConfig(dir);
    assert.equal(result.config?.memory?.enabled, false);

    await updateProjectConfig(dir, 'memory', { maxResults: 5 });
    result = await loadProjectConfig(dir);
    assert.equal(result.config?.memory?.enabled, false); // preserved
    assert.equal(result.config?.memory?.maxResults, 5); // merged
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('updateProjectConfig writes valid JSON ending with a newline', async () => {
  const dir = tmpProject();
  try {
    await updateProjectConfig(dir, 'worktree', { autoCreate: true });
    const content = fs.readFileSync(path.join(dir, '.agentos', 'config.json'), 'utf8');
    assert.ok(content.endsWith('\n'));
    assert.doesNotThrow(() => JSON.parse(content));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
