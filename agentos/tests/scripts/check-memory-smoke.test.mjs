import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'check-memory-smoke.mjs');
const PROJECT_ID = 'project-123';
const THREAD_ID = 'thread-abc';

function setupFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-memory-smoke-test-'));
  const homeDir = path.join(tmpRoot, 'home');
  const arcDir = path.join(homeDir, '.agentos');
  const cacheDir = path.join(arcDir, 'memory-cache');
  const messagesDir = path.join(arcDir, 'messages');
  const memoryRootPath = path.join(tmpRoot, 'memory-root');
  const projectId = PROJECT_ID;
  const threadId = THREAD_ID;
  const workingDirectory = path.join(tmpRoot, 'workspace');

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.mkdirSync(path.join(memoryRootPath, projectId, 'memory'), { recursive: true });
  fs.mkdirSync(workingDirectory, { recursive: true });

  fs.writeFileSync(path.join(memoryRootPath, projectId, 'MEMORY.md'), 'This project uses pnpm and Docker sandbox.\n');
  fs.writeFileSync(path.join(memoryRootPath, projectId, 'memory', 'notes.md'), 'Stable convention: run npm run lint.\n');
  fs.writeFileSync(path.join(messagesDir, `${threadId}.jsonl`), '{"id":"msg-1"}\n');
  fs.writeFileSync(path.join(workingDirectory, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'agentos-memory': { type: 'http', url: 'http://host.docker.internal:3459/mcp' },
      custom: { type: 'stdio', command: 'custom-tool' },
    },
  }, null, 2));

  fs.writeFileSync(
    path.join(cacheDir, `${projectId}.json`),
    JSON.stringify({
      version: 1,
      projectId,
      builtAt: Date.now(),
      fingerprint: 'fingerprint',
      status: {
        projectId,
        builtAt: Date.now(),
        hasMemoryFiles: true,
        hasSessionHistory: true,
        memoryFileCount: 2,
        sessionFileCount: 1,
        entryCount: 3,
        sources: ['memory', 'sessions'],
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 768,
      },
      entries: [
        {
          id: 'memory:MEMORY.md:1:1',
          source: 'memory',
          path: 'MEMORY.md',
          title: 'MEMORY.md',
          text: 'This project uses pnpm and Docker sandbox.',
          snippet: 'This project uses pnpm and Docker sandbox.',
        },
        {
          id: 'memory:memory/notes.md:1:1',
          source: 'memory',
          path: 'memory/notes.md',
          title: 'memory/notes.md',
          text: 'Stable convention: run npm run lint.',
          snippet: 'Stable convention: run npm run lint.',
        },
        {
          id: `session:${threadId}:msg-1:0`,
          source: 'sessions',
          path: `sessions/${threadId}.jsonl`,
          title: 'Memory Test Thread (user)',
          text: 'remember deployment requires buildx',
          snippet: 'remember deployment requires buildx',
          threadId,
          timestamp: Date.now(),
        },
      ],
    }),
  );

  return { homeDir, memoryRootPath, projectId, threadId, workingDirectory };
}

function runCheck(args, homeDir) {
  return spawnSync('node', [SCRIPT_PATH, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

function getCachePath(fixture) {
  return path.join(fixture.homeDir, '.agentos', 'memory-cache', `${fixture.projectId}.json`);
}

function readSnapshot(fixture) {
  return JSON.parse(fs.readFileSync(getCachePath(fixture), 'utf8'));
}

function writeSnapshot(fixture, snapshot) {
  fs.writeFileSync(getCachePath(fixture), JSON.stringify(snapshot));
}

test('memory smoke script validates indexed memory and session history', () => {
  const fixture = setupFixture();
  const result = runCheck([
    '--projectId', fixture.projectId,
    '--memoryRootPath', fixture.memoryRootPath,
    '--threadId', fixture.threadId,
    '--query', 'buildx',
    '--savedPath', 'memory/notes.md',
    '--workingDirectory', fixture.workingDirectory,
  ], fixture.homeDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS: memory cache exists/);
  assert.match(result.stdout, /PASS: indexed 1 session entries/);
  assert.match(result.stdout, /PASS: query "buildx" found/);
  assert.match(result.stdout, /PASS: saved memory path "memory\/notes.md" indexed/);
  assert.match(result.stdout, /INFO: managed MCP entries present: agentos-memory/);
});

test('memory smoke script fails when cache is missing', () => {
  const fixture = setupFixture();
  fs.unlinkSync(path.join(fixture.homeDir, '.agentos', 'memory-cache', `${fixture.projectId}.json`));

  const result = runCheck(['--projectId', fixture.projectId], fixture.homeDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /FAIL: memory cache missing/);
});

test('memory smoke script requires projectId', () => {
  const fixture = setupFixture();
  const result = runCheck([], fixture.homeDir);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\/check-memory-smoke\.mjs --projectId/);
});

test('memory smoke script reports empty cache entries, disabled semantic memory, and missing mcp config', () => {
  const fixture = setupFixture();
  const snapshot = readSnapshot(fixture);
  snapshot.entries = [];
  snapshot.status = { memoryFileCount: 0, sessionFileCount: 0 };
  writeSnapshot(fixture, snapshot);
  fs.unlinkSync(path.join(fixture.workingDirectory, '.mcp.json'));

  const result = runCheck([
    '--projectId', fixture.projectId,
    '--workingDirectory', fixture.workingDirectory,
  ], fixture.homeDir);
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /FAIL: memory cache has no indexed entries/);
  assert.match(output, /INFO: semantic memory not enabled in cache/);
  assert.match(output, /INFO: \.mcp\.json not present/);
});

test('memory smoke script reports missing memory namespace, thread log, query hit, and saved path/file failures', () => {
  const fixture = setupFixture();
  fs.rmSync(path.join(fixture.memoryRootPath, fixture.projectId), { recursive: true, force: true });
  fs.unlinkSync(path.join(fixture.homeDir, '.agentos', 'messages', `${fixture.threadId}.jsonl`));

  const result = runCheck([
    '--projectId', fixture.projectId,
    '--memoryRootPath', fixture.memoryRootPath,
    '--threadId', fixture.threadId,
    '--query', 'not-present',
    '--savedPath', 'memory\\missing.md',
  ], fixture.homeDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /FAIL: project memory namespace missing/);
  assert.match(result.stderr || result.stdout, /FAIL: thread message log missing/);
  assert.match(result.stderr || result.stdout, /FAIL: query "not-present" not found/);
  assert.match(result.stderr || result.stdout, /FAIL: saved memory path "memory\/missing\.md" not found in cache/);
  assert.match(result.stderr || result.stdout, /FAIL: saved memory file missing at .*memory\/missing\.md/);
});

test('memory smoke script reports missing persistent memory files when namespace exists without MEMORY.md or memory dir', () => {
  const fixture = setupFixture();
  fs.rmSync(path.join(fixture.memoryRootPath, fixture.projectId, 'MEMORY.md'), { force: true });
  fs.rmSync(path.join(fixture.memoryRootPath, fixture.projectId, 'memory'), { recursive: true, force: true });

  const result = runCheck([
    '--projectId', fixture.projectId,
    '--memoryRootPath', fixture.memoryRootPath,
  ], fixture.homeDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /PASS: project memory root exists/);
  assert.match(result.stderr || result.stdout, /FAIL: no MEMORY\.md or memory\/ directory found/);
});

test('memory smoke script reports missing indexed session entry and allows managed MCP none state', () => {
  const fixture = setupFixture();
  const snapshot = readSnapshot(fixture);
  snapshot.entries = snapshot.entries.filter((entry) => entry.threadId !== fixture.threadId);
  snapshot.status.embeddingModel = undefined;
  writeSnapshot(fixture, snapshot);
  fs.writeFileSync(path.join(fixture.workingDirectory, '.mcp.json'), JSON.stringify({
    mcpServers: {
      custom: { type: 'stdio', command: 'custom-tool' },
    },
  }, null, 2));

  const savedFile = path.join(fixture.memoryRootPath, fixture.projectId, 'memory', 'notes.md');
  fs.unlinkSync(savedFile);

  const result = runCheck([
    '--projectId', fixture.projectId,
    '--threadId', fixture.threadId,
    '--savedPath', 'memory/notes.md',
    '--memoryRootPath', fixture.memoryRootPath,
    '--workingDirectory', fixture.workingDirectory,
  ], fixture.homeDir);
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /FAIL: no indexed session entries found for thread-abc/);
  assert.match(output, /PASS: saved memory path "memory\/notes\.md" indexed in cache/);
  assert.match(output, /FAIL: saved memory file missing at .*memory\/notes\.md/);
  assert.match(output, /PASS: semantic memory enabled via openai\/unknown-model/);
  assert.match(output, /INFO: managed MCP entries present: none/);
});
