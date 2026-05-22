import { eventLogger } from './eventLog';

export function logNonFatal(subsystem: string, operation: string, err: unknown): void {
  eventLogger.warn(subsystem, `Non-fatal: ${operation}`, { error: String(err) });
}
