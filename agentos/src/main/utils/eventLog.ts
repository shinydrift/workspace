import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import type { AppLogEntry, LogLevel } from '../../shared/types';
import { IPC_EVENTS } from '../../shared/types';
import { getStore } from '../store/index';
import log from 'electron-log';

const MAX_LOG_ENTRIES = 1000;
const LOG_FILENAME = 'app-events.log';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 3;
const REDACTED_VALUE = '[REDACTED]';
const REDACT_KEYS = ['apikey', 'api_key', 'token', 'authorization', 'password', 'secret'];

const logBuffer: AppLogEntry[] = [];

let logsDir = '';
let logFilePath = '';

export function initEventLog(userDataPath: string): void {
  logsDir = path.join(userDataPath, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, LOG_FILENAME);
  hydrateFromDisk();
}

export function getLogHistory(): AppLogEntry[] {
  return [...logBuffer];
}

function isDebugEnabled(subsystem?: string): boolean {
  const settings = getStore().get('settings');
  if (settings.persistDebugLogs) return true;
  return subsystem === 'perf' && Boolean(settings.devMode);
}

function shouldPersistToDisk(level: LogLevel): boolean {
  if (level !== 'debug') return true;
  return Boolean(getStore().get('settings').persistDebugLogs);
}

function pushToBuffer(entry: AppLogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
}

function broadcast(entry: AppLogEntry): void {
  if (typeof BrowserWindow?.getAllWindows !== 'function') {
    return;
  }
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.LOG_ENTRY, entry);
    }
  }
}

function rotateIfNeeded(nextLineBytes: number): void {
  let size = 0;
  try {
    size = fs.statSync(logFilePath).size;
  } catch {
    size = 0;
  }

  if (size + nextLineBytes <= MAX_FILE_SIZE_BYTES) return;

  const lastIndex = MAX_FILES - 1;
  const oldest = `${logFilePath}.${lastIndex}`;
  if (fs.existsSync(oldest)) {
    fs.unlinkSync(oldest);
  }

  for (let i = lastIndex - 1; i >= 1; i--) {
    const src = `${logFilePath}.${i}`;
    const dest = `${logFilePath}.${i + 1}`;
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest);
    }
  }

  if (fs.existsSync(logFilePath)) {
    fs.renameSync(logFilePath, `${logFilePath}.1`);
  }
}

function safeAppendLine(line: string): void {
  if (!logFilePath) return;
  try {
    const bytes = Buffer.byteLength(line, 'utf8');
    rotateIfNeeded(bytes);
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch (err) {
    log.error(`Failed to append structured event log: ${(err as Error).message}`);
  }
}

const TOKEN_QUERY_PARAM_RE = /([?&])(access_token|token|api_key|apikey|secret|password|authorization)=[^&]*/gi;

function redactUrl(value: string): string {
  return value.replace(TOKEN_QUERY_PARAM_RE, '$1$2=[REDACTED]');
}

function sanitizeUnknown(value: unknown, keyHint?: string, seen = new WeakSet<object>()): unknown {
  if (keyHint && REDACT_KEYS.some((k) => keyHint.toLowerCase().includes(k))) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, undefined, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      out[key] = sanitizeUnknown(nested, key, seen);
    }
    return out;
  }

  if (typeof value === 'string') {
    return redactUrl(value);
  }

  return value;
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return sanitizeUnknown(meta) as Record<string, unknown>;
}

function emitToLegacyLogger(entry: AppLogEntry): void {
  const prefix = `[${entry.subsystem}] ${entry.message}`;
  const suffix = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
  const message = `${prefix}${suffix}`;
  if (entry.level === 'debug') log.debug(message);
  if (entry.level === 'info') log.info(message);
  if (entry.level === 'warn') log.warn(message);
  if (entry.level === 'error') log.error(message);
}

function hydrateFromDisk(): void {
  const files = [];
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    files.push(`${logFilePath}.${i}`);
  }
  files.push(logFilePath);

  for (const file of files) {
    if (!fs.existsSync(file)) continue;

    let content = '';
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as AppLogEntry;
        if (!parsed.id || !parsed.level || !parsed.message) continue;
        if (parsed.level === 'debug' && !isDebugEnabled(parsed.subsystem)) continue;
        pushToBuffer(parsed);
      } catch {
        // Corrupted lines are ignored to keep startup resilient.
      }
    }
  }
}

function createEntry(level: LogLevel, subsystem: string, message: string, meta?: Record<string, unknown>): AppLogEntry {
  return {
    id: nanoid(),
    ts: Date.now(),
    level,
    subsystem,
    message,
    meta: sanitizeMeta(meta),
  };
}

export function writeAppLog(level: LogLevel, subsystem: string, message: string, meta?: Record<string, unknown>): void {
  if (level === 'debug' && !isDebugEnabled(subsystem)) return;

  const entry = createEntry(level, subsystem, message, meta);
  pushToBuffer(entry);
  broadcast(entry);
  if (shouldPersistToDisk(level)) {
    emitToLegacyLogger(entry);
    safeAppendLine(`${JSON.stringify(entry)}\n`);
  }
}

export const eventLogger = {
  debug: (subsystem: string, message: string, meta?: Record<string, unknown>) =>
    writeAppLog('debug', subsystem, message, meta),
  info: (subsystem: string, message: string, meta?: Record<string, unknown>) =>
    writeAppLog('info', subsystem, message, meta),
  warn: (subsystem: string, message: string, meta?: Record<string, unknown>) =>
    writeAppLog('warn', subsystem, message, meta),
  error: (subsystem: string, message: string, meta?: Record<string, unknown>) =>
    writeAppLog('error', subsystem, message, meta),
};
