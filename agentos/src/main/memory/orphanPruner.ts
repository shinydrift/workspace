import fs from 'fs';
import path from 'path';
import { getAllProjects } from '../threads/db';
import * as threadStore from '../threads/threadStore';
import { getStore } from '../store/index';
import { eventLogger } from '../utils/eventLog';

export async function pruneOrphanData(homeDir: string, memoryDir: string): Promise<void> {
  const knownProjectIds = new Set(getAllProjects().map((p) => p.id));
  const knownThreadIds = new Set(threadStore.getAllThreads().map((t) => t.id));
  let pruned = 0;

  const tryUnlink = async (p: string) => {
    try {
      await fs.promises.unlink(p);
      pruned++;
    } catch {
      /* ignore */
    }
  };

  const memDbDir = path.join(homeDir, '.agentos', 'memory', 'projects');
  try {
    const files = await fs.promises.readdir(memDbDir);
    for (const file of files) {
      if (!file.endsWith('.sqlite')) continue;
      if (!knownProjectIds.has(file.slice(0, -7))) await tryUnlink(path.join(memDbDir, file));
    }
  } catch {
    /* dir may not exist yet */
  }

  const logRetentionDays = getStore().get('settings').logRetentionDays ?? 30;
  const logCutoffMs = Date.now() - logRetentionDays * 24 * 60 * 60 * 1000;

  const logsDir = path.join(memoryDir, 'logs');
  try {
    const files = await fs.promises.readdir(logsDir);
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const logPath = path.join(logsDir, file);
      const isOrphan = !knownThreadIds.has(file.slice(0, -4));
      if (isOrphan) {
        await tryUnlink(logPath);
        continue;
      }
      try {
        const stat = await fs.promises.stat(logPath);
        if (stat.mtimeMs < logCutoffMs) await tryUnlink(logPath);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* dir may not exist yet */
  }

  const messagesDir = path.join(memoryDir, 'messages');
  try {
    const files = await fs.promises.readdir(messagesDir);
    for (const file of files) {
      if (file.endsWith('.jsonl') && !knownThreadIds.has(file.slice(0, -6))) {
        await tryUnlink(path.join(messagesDir, file));
      }
    }
  } catch {
    /* dir may not exist yet */
  }

  if (pruned > 0) eventLogger.info('memory', 'Pruned orphan data files', { pruned });
}
