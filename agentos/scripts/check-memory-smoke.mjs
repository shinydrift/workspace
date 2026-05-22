#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function info(message) {
  console.log(`INFO: ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function containsQuery(entry, query) {
  return String(entry.text ?? '').toLowerCase().includes(query.toLowerCase())
    || String(entry.snippet ?? '').toLowerCase().includes(query.toLowerCase())
    || String(entry.title ?? '').toLowerCase().includes(query.toLowerCase());
}

function main() {
  const args = parseArgs(process.argv);
  const projectId = args.projectId;
  if (!projectId) {
    console.error('Usage: node scripts/check-memory-smoke.mjs --projectId <id> [--memoryRootPath <path>] [--threadId <id>] [--query <text>] [--savedPath <relpath>] [--workingDirectory <path>]');
    process.exit(2);
  }

  const memoryRootPath = args.memoryRootPath ?? null;
  const threadId = args.threadId ?? null;
  const query = args.query ?? null;
  const savedPath = args.savedPath ?? null;
  const workingDirectory = args.workingDirectory ?? null;
  const arcHome = path.join(os.homedir(), '.agentos');
  const cachePath = path.join(arcHome, 'memory-cache', `${projectId}.json`);
  const messagesDir = path.join(arcHome, 'messages');

  info(`projectId=${projectId}`);
  info(`cachePath=${cachePath}`);

  if (!fs.existsSync(cachePath)) {
    fail(`memory cache missing at ${cachePath}`);
    return;
  }

  const snapshot = readJson(cachePath);
  if (!snapshot || typeof snapshot !== 'object') {
    fail('memory cache is not valid JSON');
    return;
  }
  pass('memory cache exists');

  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  if (entries.length === 0) {
    fail('memory cache has no indexed entries');
  } else {
    pass(`memory cache contains ${entries.length} indexed entries`);
  }

  const status = snapshot.status ?? {};
  info(`indexed memory files=${status.memoryFileCount ?? 0}, session files=${status.sessionFileCount ?? 0}`);
  if (status.embeddingProvider) {
    pass(`semantic memory enabled via ${status.embeddingProvider}/${status.embeddingModel ?? 'unknown-model'}`);
  } else {
    info('semantic memory not enabled in cache');
  }

  if (memoryRootPath) {
    const projectRoot = path.join(memoryRootPath, projectId);
    if (fs.existsSync(projectRoot)) {
      pass(`project memory root exists at ${projectRoot}`);
      const memoryFile = path.join(projectRoot, 'MEMORY.md');
      const memoryDir = path.join(projectRoot, 'memory');
      if (fs.existsSync(memoryFile) || fs.existsSync(memoryDir)) {
        pass('persistent memory files are present');
      } else {
        fail('no MEMORY.md or memory/ directory found');
      }
    } else {
      fail(`project memory namespace missing at ${projectRoot}`);
    }
  }

  if (threadId) {
    const messageFile = path.join(messagesDir, `${threadId}.jsonl`);
    if (!fs.existsSync(messageFile)) {
      fail(`thread message log missing at ${messageFile}`);
    } else {
      pass(`thread message log exists for ${threadId}`);
      const sessionEntries = entries.filter((entry) => entry.threadId === threadId || entry.path === `sessions/${threadId}.jsonl`);
      if (sessionEntries.length === 0) {
        fail(`no indexed session entries found for ${threadId}`);
      } else {
        pass(`indexed ${sessionEntries.length} session entries for ${threadId}`);
      }
    }
  }

  if (query) {
    const matches = entries.filter((entry) => containsQuery(entry, query));
    if (matches.length === 0) {
      fail(`query "${query}" not found in indexed memory cache`);
    } else {
      pass(`query "${query}" found in ${matches.length} indexed entries`);
      info(`top hit: ${matches[0].title} [${matches[0].path}]`);
    }
  }

  if (savedPath) {
    const normalized = savedPath.replace(/\\/g, '/');
    const matchingEntries = entries.filter((entry) => entry.path === normalized);
    if (matchingEntries.length === 0) {
      fail(`saved memory path "${normalized}" not found in cache`);
    } else {
      pass(`saved memory path "${normalized}" indexed in cache`);
    }
    if (memoryRootPath) {
      const fullSavedPath = path.join(memoryRootPath, projectId, normalized);
      if (!fs.existsSync(fullSavedPath)) {
        fail(`saved memory file missing at ${fullSavedPath}`);
      } else {
        pass(`saved memory file exists at ${fullSavedPath}`);
      }
    }
  }

  if (workingDirectory) {
    const mcpPath = path.join(workingDirectory, '.mcp.json');
    if (!fs.existsSync(mcpPath)) {
      info('.mcp.json not present');
    } else {
      const mcpConfig = readJson(mcpPath);
      const servers = mcpConfig.mcpServers ?? {};
      const managed = ['agentos-memory', 'agentos-slack', 'agentos-imessage'].filter((name) => name in servers);
      info(`managed MCP entries present: ${managed.join(', ') || 'none'}`);
    }
  }
}

main();
