import { getStore, settingsEvents } from '../../store/index';
import { getAllProjects, getProject } from '../../threads/db';
import * as threadStore from '../../threads/threadStore';
import { broadcastToWindows } from '../../sessions/broadcaster';
import { writeAppLog } from '../../utils/eventLog';
import { loadProjectConfigSync } from '../../config/projectConfig';
import type { AppSettings } from '../../../shared/types';
import type { MemoryRuntime, RuntimeThread } from '../runtime';

function projectThread(t: { id: string; name: string; projectId: string }): RuntimeThread {
  return { id: t.id, name: t.name, projectId: t.projectId };
}

export function createMainMemoryRuntime(): MemoryRuntime {
  return {
    getSettings: () => getStore().get('settings'),
    onSettingsChange: (cb: (s: AppSettings) => void) => {
      settingsEvents.on('change', cb);
      return () => {
        settingsEvents.off('change', cb);
      };
    },
    getProjects: () => getAllProjects(),
    getProject: (id) => getProject(id),
    getThread: (id) => {
      const t = threadStore.getThread(id);
      return t ? projectThread(t) : null;
    },
    getThreadsByProject: (projectId) => threadStore.getThreadsByProject(projectId).map(projectThread),
    getAllThreads: () => threadStore.getAllThreads().map(projectThread),
    loadProjectConfigSync: (p) => loadProjectConfigSync(p),
    broadcastEvent: (channel, payload) => broadcastToWindows(channel, payload),
    log: (level, subsystem, msg, meta) => writeAppLog(level, subsystem, msg, meta),
  };
}
