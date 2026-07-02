import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import { pruneSegmentsOlderThan } from '../threads/db';
import { eventLogger } from '../utils/eventLog';

// Continuous-capture segments are kept for 7 days, then pruned (rows + audio/transcript
// files). Manual meeting recordings are never touched by this sweep.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

function recordingsRoot(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

async function sweep(): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  const filePaths = pruneSegmentsOlderThan(cutoff);
  if (filePaths.length === 0) return;
  const root = path.resolve(recordingsRoot()) + path.sep;
  const dirs = new Set<string>();
  for (const p of filePaths) {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(root)) continue;
    dirs.add(path.dirname(resolved));
  }
  // Segment audio + transcript share one directory ({recordingId}/); remove the dir.
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  eventLogger.info('recordings', 'Pruned expired capture segments', { count: dirs.size });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Prune once at startup, then hourly. Idempotent — safe to call once from bootstrap. */
export function startSegmentRetention(): void {
  void sweep().catch((error: unknown) => {
    eventLogger.warn('recordings', 'Segment retention sweep failed', { error: String(error) });
  });
  if (timer) return;
  timer = setInterval(() => {
    void sweep().catch((error: unknown) => {
      eventLogger.warn('recordings', 'Segment retention sweep failed', { error: String(error) });
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopSegmentRetention(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
