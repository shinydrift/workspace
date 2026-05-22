import { ipcMain } from 'electron';
import type { ZodType } from 'zod';
import { eventLogger } from '../utils/eventLog';

export type IpcResponse<T = void> = { ok: true; data: T } | { ok: false; error: string };

export async function handleIpc<T>(fn: () => Promise<T> | T): Promise<IpcResponse<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    eventLogger.error('ipc', 'handler error', { error: String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Register a typed IPC handler: parses raw input with schema, passes result to fn. */
export function defineHandler<T>(
  channel: string,
  schema: ZodType<T>,
  fn: (parsed: T) => Promise<unknown> | unknown
): void {
  ipcMain.handle(channel, (_e, raw) => handleIpc(() => fn(schema.parse(raw))));
}
