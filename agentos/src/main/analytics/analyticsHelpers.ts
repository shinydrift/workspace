import { getAnalyticsDb } from './db';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import * as threadStore from '../threads/threadStore';

export function safeOpen<T>(opener: () => T, label: string, context?: Record<string, unknown>): T | null {
  try {
    return opener();
  } catch (err) {
    eventLogger.error('analytics', label, { ...context, error: getErrorMessage(err) });
    return null;
  }
}

export function safeDb() {
  return safeOpen(getAnalyticsDb, 'Failed to open analytics DB');
}

export function getProjectIdForThread(threadId: string): string | null {
  const thread = threadStore.getThread(threadId);
  if (!thread) return null;
  return thread.projectId ?? null;
}
