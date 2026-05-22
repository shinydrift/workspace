import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { performance } from 'node:perf_hooks';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { nanoid } from 'nanoid';
import { getStore } from '../store/index';
import { eventLogger } from './eventLog';

type TraceContext = {
  traceId: string;
  channel: string;
  emitting: number; // re-entrancy guard — per-trace, not process-wide
};

type WrappedFn = (...args: unknown[]) => unknown;
type WrappedCallable = WrappedFn & { [WRAPPED]?: boolean };

const traceStorage = new AsyncLocalStorage<TraceContext>();
const WRAPPED = Symbol('agentos.perfTraceWrapped');
const wrappedStatements = new WeakSet<object>();

let installed = false;

function isWrapped(value: unknown): value is WrappedCallable {
  return typeof value === 'function' && Boolean((value as WrappedCallable)[WRAPPED]);
}

function markWrapped<T extends WrappedFn>(fn: T): T {
  (fn as WrappedCallable)[WRAPPED] = true;
  return fn;
}

function isTraceLoggingEnabled(): boolean {
  try {
    const settings = getStore().get('settings');
    return Boolean(settings.persistDebugLogs || settings.devMode);
  } catch {
    return false;
  }
}

function getTraceContext(): TraceContext | null {
  if (!isTraceLoggingEnabled()) return null;
  return traceStorage.getStore() ?? null;
}

function durationMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizePath(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.pathname || value.href;
  return '[unknown]';
}

function summarizeSql(sql: unknown): string {
  if (typeof sql !== 'string') return '[unknown]';
  const compact = sql.replace(/\s+/g, ' ').trim();
  return compact.length <= 140 ? compact : `${compact.slice(0, 137)}...`;
}

function summarizeUrl(input: Parameters<typeof fetch>[0], init?: RequestInit): { method: string; url: string } {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET') ?? 'GET').toUpperCase();
  let raw = '';
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = input.url;

  try {
    const parsed = new URL(raw);
    return { method, url: `${parsed.origin}${parsed.pathname}` };
  } catch {
    return { method, url: raw };
  }
}

function emitTrace(message: string, meta: Record<string, unknown>): void {
  const trace = getTraceContext();
  if (!trace || trace.emitting > 0) return;

  try {
    trace.emitting += 1;
    eventLogger.debug('perf', message, {
      traceId: trace.traceId,
      channel: trace.channel,
      ...meta,
    });
  } finally {
    trace.emitting -= 1;
  }
}

async function withIpcTrace<T>(channel: string, fn: () => Promise<T> | T): Promise<T> {
  if (!isTraceLoggingEnabled()) return await fn();

  const traceId = nanoid(10);
  const start = performance.now();

  return await traceStorage.run({ traceId, channel, emitting: 0 }, async () => {
    emitTrace('ipc:start', {});
    try {
      const result = await fn();
      emitTrace('ipc:end', { durationMs: durationMs(start) });
      return result;
    } catch (error) {
      emitTrace('ipc:error', { durationMs: durationMs(start), error: getErrorMessage(error) });
      throw error;
    }
  });
}

function wrapAsyncMethod(target: Record<string, unknown>, methodName: string, kind: string): void {
  const original = target[methodName];
  if (typeof original !== 'function') return;
  if (isWrapped(original)) return;

  const wrapped = function wrappedFsMethod(this: unknown, ...args: unknown[]) {
    const trace = getTraceContext();
    if (!trace) {
      return (original as WrappedFn).apply(this, args);
    }

    const start = performance.now();
    const targetPath = summarizePath(args[0]);
    const lastArg = args.at(-1);
    if (typeof lastArg === 'function') {
      const nextArgs = [...args];
      nextArgs[nextArgs.length - 1] = (...callbackArgs: unknown[]) => {
        const error = callbackArgs[0];
        if (error == null) {
          emitTrace(kind, { op: methodName, path: targetPath, durationMs: durationMs(start) });
        } else {
          emitTrace(`${kind}:error`, {
            op: methodName,
            path: targetPath,
            durationMs: durationMs(start),
            error: getErrorMessage(error),
          });
        }
        return (lastArg as WrappedFn)(...callbackArgs);
      };
      return (original as WrappedFn).apply(this, nextArgs);
    }

    try {
      const result = (original as WrappedFn).apply(this, args);
      if (!result || typeof (result as Promise<unknown>).then !== 'function') {
        emitTrace(kind, { op: methodName, path: targetPath, durationMs: durationMs(start) });
        return result;
      }
      return (result as Promise<unknown>)
        .then((value) => {
          emitTrace(kind, { op: methodName, path: targetPath, durationMs: durationMs(start) });
          return value;
        })
        .catch((error) => {
          emitTrace(`${kind}:error`, {
            op: methodName,
            path: targetPath,
            durationMs: durationMs(start),
            error: getErrorMessage(error),
          });
          throw error;
        });
    } catch (error) {
      emitTrace(`${kind}:error`, {
        op: methodName,
        path: targetPath,
        durationMs: durationMs(start),
        error: getErrorMessage(error),
      });
      throw error;
    }
  };

  target[methodName] = markWrapped(wrapped);
}

function patchFs(): void {
  // Sync fs methods are not patched — wrapping them causes hangs in Electron's native fs bindings.
  const asyncMethods = ['readFile', 'writeFile', 'readdir', 'stat', 'lstat', 'mkdir', 'rm', 'unlink', 'copyFile'];

  for (const method of asyncMethods) wrapAsyncMethod(fs as unknown as Record<string, unknown>, method, 'fs');
  for (const method of asyncMethods) wrapAsyncMethod(fsPromises as unknown as Record<string, unknown>, method, 'fs');
}

function wrapDbPrototypeMethod(target: Record<string, unknown>, methodName: string): void {
  const original = target[methodName];
  if (typeof original !== 'function') return;
  if (isWrapped(original)) return;

  const wrapped = function wrappedDbMethod(this: unknown, ...args: unknown[]) {
    const trace = getTraceContext();
    if (!trace) return (original as WrappedFn).apply(this, args);

    const start = performance.now();
    const sql = summarizeSql(args[0]);
    try {
      const result = (original as WrappedFn).apply(this, args);
      emitTrace('db', { op: methodName, sql, durationMs: durationMs(start) });
      return result;
    } catch (error) {
      emitTrace('db:error', { op: methodName, sql, durationMs: durationMs(start), error: getErrorMessage(error) });
      throw error;
    }
  };

  target[methodName] = markWrapped(wrapped);
}

function patchFetch(): void {
  if (typeof globalThis.fetch !== 'function') return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  if (isWrapped(globalThis.fetch)) return;

  const wrappedFetch: typeof fetch = async (input, init) => {
    const trace = getTraceContext();
    if (!trace) return originalFetch(input, init);

    const start = performance.now();
    const { method, url } = summarizeUrl(input, init);
    try {
      const response = await originalFetch(input, init);
      emitTrace('http', { method, url, status: response.status, durationMs: durationMs(start) });
      return response;
    } catch (error) {
      emitTrace('http:error', {
        method,
        url,
        durationMs: durationMs(start),
        error: getErrorMessage(error),
      });
      throw error;
    }
  };

  globalThis.fetch = markWrapped(wrappedFetch);
}

function wrapStatementMethod(statement: Record<string, unknown>, methodName: string, sql: string): void {
  const original = statement[methodName];
  if (typeof original !== 'function') return;
  if (isWrapped(original)) return;

  const wrapped = function wrappedStatementMethod(this: unknown, ...args: unknown[]) {
    const trace = getTraceContext();
    if (!trace) return (original as WrappedFn).apply(this, args);

    const start = performance.now();
    try {
      const result = (original as WrappedFn).apply(this, args);
      emitTrace('db', { op: methodName, sql: summarizeSql(sql), durationMs: durationMs(start) });
      return result;
    } catch (error) {
      emitTrace('db:error', {
        op: methodName,
        sql: summarizeSql(sql),
        durationMs: durationMs(start),
        error: getErrorMessage(error),
      });
      throw error;
    }
  };

  statement[methodName] = markWrapped(wrapped);
}

function wrapStatement(statement: unknown, sql: string): void {
  if (!statement || typeof statement !== 'object') return;
  if (wrappedStatements.has(statement)) return;
  wrappedStatements.add(statement);

  const target = statement as Record<string, unknown>;
  for (const method of ['run', 'get', 'all', 'iterate']) {
    wrapStatementMethod(target, method, sql);
  }
}

function patchBetterSqlite(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSQLite3 = require('better-sqlite3') as { prototype?: Record<string, unknown> };
    const dbProto = BetterSQLite3.prototype;
    if (!dbProto) return;

    wrapDbPrototypeMethod(dbProto, 'exec');
    wrapDbPrototypeMethod(dbProto, 'pragma');

    const originalPrepare = dbProto.prepare;
    if (typeof originalPrepare === 'function' && !isWrapped(originalPrepare)) {
      const wrappedPrepare = function wrappedPrepare(this: unknown, sql: string, ...args: unknown[]) {
        const statement = (originalPrepare as WrappedFn).call(this, sql, ...args);
        wrapStatement(statement, sql);
        return statement;
      };
      dbProto.prepare = markWrapped(wrappedPrepare);
    }
  } catch {
    // Ignore in environments where better-sqlite3 is unavailable.
  }
}

function patchIpcMain(): void {
  const target = ipcMain as unknown as { handle: typeof ipcMain.handle };
  const originalHandle = target.handle.bind(ipcMain);
  if (isWrapped(target.handle)) return;

  const wrappedHandle: typeof ipcMain.handle = ((channel, listener) => {
    return originalHandle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      withIpcTrace(channel, () => listener(event, ...args))
    );
  }) as typeof ipcMain.handle;

  target.handle = markWrapped(wrappedHandle);
}

export function installPerfTraceInstrumentation(): void {
  if (installed) return;
  installed = true;

  patchIpcMain();
  patchFetch();
  patchFs();
  patchBetterSqlite();
}
