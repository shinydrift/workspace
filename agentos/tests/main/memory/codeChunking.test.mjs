import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Inlined from codeChunking.ts ──────────────────────────────────────────────

const EXT_TO_LANG = { '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript',
  '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python' };
const MAX_FILE_BYTES = 500_000;

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', '.vite', 'coverage',
  '__pycache__', '.next', '.nuxt', '.cache', 'vendor', 'target', '.turbo', '.yarn',
]);

async function listCodeFilesGit(dir) {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { maxBuffer: 50 * 1024 * 1024 },
  );
  const candidates = stdout.split('\0').filter(Boolean).map((f) => path.join(dir, f));
  const results = [];
  await Promise.all(
    candidates.map(async (full) => {
      const ext = path.extname(full).toLowerCase();
      if (!EXT_TO_LANG[ext]) return;
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size <= MAX_FILE_BYTES) results.push(full);
      } catch { /* ignore */ }
    }),
  );
  return results;
}

async function listCodeFilesWalk(dir) {
  const results = [];
  const recurse = async (d) => {
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); }
    catch { return; }
    const pending = [];
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) pending.push(recurse(full));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!EXT_TO_LANG[ext]) continue;
      pending.push(
        fs.promises.stat(full).then((stat) => {
          if (stat.size <= MAX_FILE_BYTES) results.push(full);
        }).catch(() => {}),
      );
    }
    await Promise.all(pending);
  };
  await recurse(dir);
  return results;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-chunking-test-'));
}

function gitInit(dir) {
  execFileSync('git', ['-C', dir, 'init', '--quiet']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
}

// ── listCodeFilesGit ──────────────────────────────────────────────────────────

test('listCodeFilesGit returns tracked .ts files', async () => {
  const dir = makeTempDir();
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;');
    execFileSync('git', ['-C', dir, 'add', 'index.ts']);
    const files = await listCodeFilesGit(dir);
    assert.ok(files.some((f) => f.endsWith('index.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesGit returns untracked non-ignored .ts files', async () => {
  const dir = makeTempDir();
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'new.ts'), 'export const y = 2;');
    // not staged — untracked but not gitignored
    const files = await listCodeFilesGit(dir);
    assert.ok(files.some((f) => f.endsWith('new.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesGit excludes gitignored files', async () => {
  const dir = makeTempDir();
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.ts\n');
    fs.writeFileSync(path.join(dir, 'ignored.ts'), 'export const z = 3;');
    fs.writeFileSync(path.join(dir, 'kept.ts'), 'export const w = 4;');
    execFileSync('git', ['-C', dir, 'add', '.gitignore', 'kept.ts']);
    const files = await listCodeFilesGit(dir);
    assert.ok(!files.some((f) => f.endsWith('ignored.ts')));
    assert.ok(files.some((f) => f.endsWith('kept.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesGit excludes non-code file extensions', async () => {
  const dir = makeTempDir();
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'data.json'), '{}');
    fs.writeFileSync(path.join(dir, 'style.css'), 'body {}');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;');
    execFileSync('git', ['-C', dir, 'add', '.']);
    const files = await listCodeFilesGit(dir);
    assert.ok(!files.some((f) => f.endsWith('.json') || f.endsWith('.css')));
    assert.ok(files.some((f) => f.endsWith('index.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesGit excludes files over MAX_FILE_BYTES', async () => {
  const dir = makeTempDir();
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'big.ts'), 'x'.repeat(MAX_FILE_BYTES + 1));
    execFileSync('git', ['-C', dir, 'add', 'big.ts']);
    const files = await listCodeFilesGit(dir);
    assert.ok(!files.some((f) => f.endsWith('big.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesGit throws for non-git directory', async () => {
  const dir = makeTempDir();
  try {
    await assert.rejects(() => listCodeFilesGit(dir));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ── listCodeFilesWalk ─────────────────────────────────────────────────────────

test('listCodeFilesWalk returns supported files', async () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(dir, 'b.py'), 'print("hi")');
    const files = await listCodeFilesWalk(dir);
    assert.ok(files.some((f) => f.endsWith('a.ts')));
    assert.ok(files.some((f) => f.endsWith('b.py')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesWalk skips IGNORED_DIRS', async () => {
  const dir = makeTempDir();
  try {
    const nm = path.join(dir, 'node_modules');
    fs.mkdirSync(nm);
    fs.writeFileSync(path.join(nm, 'pkg.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const y = 2;');
    const files = await listCodeFilesWalk(dir);
    assert.ok(!files.some((f) => f.includes('node_modules')));
    assert.ok(files.some((f) => f.endsWith('index.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesWalk skips unsupported extensions', async () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'readme.md'), '# hi');
    fs.writeFileSync(path.join(dir, 'data.json'), '{}');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;');
    const files = await listCodeFilesWalk(dir);
    assert.ok(!files.some((f) => f.endsWith('.md') || f.endsWith('.json')));
    assert.ok(files.some((f) => f.endsWith('index.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('listCodeFilesWalk returns empty array for empty directory', async () => {
  const dir = makeTempDir();
  try {
    const files = await listCodeFilesWalk(dir);
    assert.deepEqual(files, []);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
