import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { Parser, Node, Language } from 'web-tree-sitter';
import { MEMORY_SECTION_MAX_CHARS } from './chunking';
import type { TextChunk } from './chunking';
import { runtimeLogger as eventLogger } from './runtime';

const execFileAsync = promisify(execFile);

const _require = createRequire(import.meta.url);
// In the packaged app, web-tree-sitter is bundled by Vite and its node_modules
// directory is excluded from the asar — require.resolve would throw at load
// time. Resolve lazily so production hits the process.resourcesPath branch in
// resolveWasmPath first and never needs this fallback.
let _nodeModulesCache: string | null = null;
function getNodeModulesRoot(): string {
  if (_nodeModulesCache !== null) return _nodeModulesCache;
  try {
    _nodeModulesCache = path.dirname(path.dirname(_require.resolve('web-tree-sitter')));
  } catch {
    _nodeModulesCache = '';
  }
  return _nodeModulesCache;
}

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

// Used by the non-git fallback walk only.
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  '.vite',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  'vendor',
  'target',
  '.turbo',
  '.yarn',
]);

const MAX_FILE_BYTES = 500_000;

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();

function resolveWasmPath(filename: string, pkg: string, subdir = ''): string {
  const prod = path.join(process.resourcesPath ?? '', filename);
  if (fs.existsSync(prod)) return prod;
  return path.join(getNodeModulesRoot(), pkg, subdir, filename);
}

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    const wasmDir = path.dirname(resolveWasmPath('tree-sitter.wasm', 'web-tree-sitter'));
    initPromise = Parser.init({ locateFile: (name: string) => path.join(wasmDir, name) });
  }
  return initPromise;
}

async function loadLanguage(lang: string): Promise<Language | null> {
  if (languageCache.has(lang)) return languageCache.get(lang)!;
  const grammarPath = resolveWasmPath(`tree-sitter-${lang}.wasm`, 'tree-sitter-wasms', 'out');
  if (!fs.existsSync(grammarPath)) return null;
  const language = await Language.load(grammarPath);
  languageCache.set(lang, language);
  return language;
}

async function listCodeFilesGit(dir: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  const candidates = stdout
    .split('\0')
    .filter(Boolean)
    .map((f) => path.join(dir, f));
  const results: string[] = [];
  await Promise.all(
    candidates.map(async (full) => {
      const ext = path.extname(full).toLowerCase();
      if (!EXT_TO_LANG[ext]) return;
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size <= MAX_FILE_BYTES) results.push(full);
      } catch {
        /* ignore unreadable files */
      }
    })
  );
  return results;
}

async function listCodeFilesWalk(dir: string): Promise<string[]> {
  const results: string[] = [];
  const recurse = async (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    const pending: Promise<void>[] = [];
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
        fs.promises
          .stat(full)
          .then((stat) => {
            if (stat.size <= MAX_FILE_BYTES) results.push(full);
          })
          .catch(() => {
            /* ignore unreadable files */
          })
      );
    }
    await Promise.all(pending);
  };
  await recurse(dir);
  return results;
}

export async function listCodeFiles(dir: string): Promise<string[]> {
  try {
    return await listCodeFilesGit(dir);
  } catch (err) {
    eventLogger.warn('memory', 'git ls-files failed, falling back to filesystem walk', {
      dir,
      error: String(err),
    });
    return listCodeFilesWalk(dir);
  }
}

// Chunks shorter than this are merged into an adjacent chunk for context rather than emitted alone.
const MIN_STANDALONE_CHUNK = 120;
// Safety cap: fall back to line-based split beyond this recursion depth to avoid stack overflow.
const MAX_CHUNK_DEPTH = 50;

function chunkNode(node: Node, content: string, absPath: string, chunks: TextChunk[], depth = 0): void {
  const text = content.slice(node.startIndex, node.endIndex).trim();
  if (!text) return;

  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;

  if (text.length <= MEMORY_SECTION_MAX_CHARS) {
    chunks.push({ text, startLine, endLine, contextHeader: `[${absPath}:${startLine}]` });
    return;
  }

  // Too large — recurse into named children, grouping small adjacent ones.
  // Terminates naturally: nodes either fit (base case) or have no named children (line-based fallback).
  if (depth < MAX_CHUNK_DEPTH && node.namedChildCount > 0) {
    const invocationStart = chunks.length;
    let groupTexts: string[] = [];
    let groupStart = 0;
    let groupEnd = 0;
    let groupLen = 0;

    const flushChildGroup = () => {
      if (groupTexts.length === 0) return;
      const t = groupTexts.join('\n').trim();
      if (t)
        chunks.push({ text: t, startLine: groupStart, endLine: groupEnd, contextHeader: `[${absPath}:${groupStart}]` });
      groupTexts = [];
      groupLen = 0;
    };

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      const childText = content.slice(child.startIndex, child.endIndex).trim();
      if (!childText) continue;
      const childStart = child.startPosition.row + 1;
      const childEnd = child.endPosition.row + 1;

      if (childText.length > MEMORY_SECTION_MAX_CHARS) {
        const beforeFlush = chunks.length;
        flushChildGroup();
        const afterFlush = chunks.length;
        chunkNode(child, content, absPath, chunks, depth + 1);
        // If a short prefix group was flushed (e.g. a function name before its body),
        // merge it into the child's first chunk so it doesn't become a tiny standalone fragment.
        if (afterFlush > beforeFlush && chunks.length > afterFlush) {
          const prefix = chunks[afterFlush - 1];
          if (prefix.text.length < MIN_STANDALONE_CHUNK) {
            const first = chunks[afterFlush];
            first.text = prefix.text + '\n' + first.text;
            first.startLine = Math.min(prefix.startLine, first.startLine);
            first.contextHeader = prefix.contextHeader ?? first.contextHeader;
            chunks.splice(afterFlush - 1, 1);
          }
        }
      } else {
        const sep = groupLen > 0 ? 1 : 0;
        if (groupLen + sep + childText.length > MEMORY_SECTION_MAX_CHARS) {
          flushChildGroup();
          groupTexts = [childText];
          groupStart = childStart;
          groupEnd = childEnd;
          groupLen = childText.length;
        } else {
          if (groupTexts.length === 0) groupStart = childStart;
          groupTexts.push(childText);
          groupEnd = childEnd;
          groupLen += sep + childText.length;
        }
      }
    }

    // Flush remaining group; merge into previous chunk if it's too small to stand alone.
    const beforeFinal = chunks.length;
    flushChildGroup();
    if (chunks.length > beforeFinal && beforeFinal > invocationStart) {
      const tail = chunks[chunks.length - 1];
      if (tail.text.length < MIN_STANDALONE_CHUNK) {
        const prev = chunks[chunks.length - 2];
        prev.text = prev.text + '\n' + tail.text;
        prev.endLine = Math.max(prev.endLine, tail.endLine);
        chunks.pop();
      }
    }
    return;
  }

  // Fallback: line-based split for leaf nodes or pathologically deep trees.
  const lines = content.slice(node.startIndex, node.endIndex).split('\n');
  let sliceLines: string[] = [];
  let sliceStart = startLine;
  const lineBasedStart = chunks.length;
  for (const line of lines) {
    sliceLines.push(line);
    if (sliceLines.join('\n').length >= MEMORY_SECTION_MAX_CHARS) {
      const sliceText = sliceLines.join('\n').trim();
      if (sliceText)
        chunks.push({ text: sliceText, startLine: sliceStart, endLine: sliceStart + sliceLines.length - 1 });
      sliceStart += sliceLines.length;
      sliceLines = [];
    }
  }
  if (sliceLines.length > 0) {
    const sliceText = sliceLines.join('\n').trim();
    if (sliceText) {
      // Merge tiny trailing content (e.g. closing `};`) into the previous chunk rather than emitting alone.
      if (chunks.length > lineBasedStart && sliceText.length < MIN_STANDALONE_CHUNK) {
        const prev = chunks[chunks.length - 1];
        prev.text = prev.text + '\n' + sliceText;
        prev.endLine = sliceStart + sliceLines.length - 1;
      } else {
        chunks.push({ text: sliceText, startLine: sliceStart, endLine: sliceStart + sliceLines.length - 1 });
      }
    }
  }
}

export async function splitCodeBySymbols(content: string, absPath: string): Promise<TextChunk[]> {
  const ext = path.extname(absPath).toLowerCase();
  const lang = EXT_TO_LANG[ext];
  if (!lang) return [];

  await ensureInit();
  const language = await loadLanguage(lang);
  if (!language) return [];

  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(content);
  const chunks: TextChunk[] = [];

  let groupTexts: string[] = [];
  let groupStart = 0;
  let groupEnd = 0;
  let groupLen = 0;

  const flushGroup = () => {
    if (groupTexts.length === 0) return;
    const text = groupTexts.join('\n').trim();
    if (text)
      chunks.push({ text, startLine: groupStart, endLine: groupEnd, contextHeader: `[${absPath}:${groupStart}]` });
    groupTexts = [];
    groupLen = 0;
  };

  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    const child = tree.rootNode.namedChild(i);
    if (!child) continue;
    const nodeText = content.slice(child.startIndex, child.endIndex).trim();
    if (!nodeText) continue;
    const startLine = child.startPosition.row + 1;
    const endLine = child.endPosition.row + 1;

    if (nodeText.length > MEMORY_SECTION_MAX_CHARS) {
      // Too large to merge — flush group, then recurse into children
      flushGroup();
      chunkNode(child, content, absPath, chunks);
    } else {
      const sep = groupLen > 0 ? 1 : 0;
      if (groupLen + sep + nodeText.length > MEMORY_SECTION_MAX_CHARS) {
        // Would overflow — flush and start fresh
        flushGroup();
        groupTexts = [nodeText];
        groupStart = startLine;
        groupEnd = endLine;
        groupLen = nodeText.length;
      } else {
        if (groupTexts.length === 0) groupStart = startLine;
        groupTexts.push(nodeText);
        groupEnd = endLine;
        groupLen += sep + nodeText.length;
      }
    }
  }
  flushGroup();

  return chunks;
}
