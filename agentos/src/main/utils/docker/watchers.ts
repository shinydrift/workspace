import crypto from 'crypto';
import fs from 'fs';
import { getProject, getAllProjects, saveProjectToDb } from '../../threads/db';
import { eventLogger } from '../eventLog';
import { getStore } from '../../store';
import { ensureImageBuilt, getImageId } from './client';
import { GLOBAL_IMAGE_NAME, markSandboxImageBuilt } from './constants';
import { getSandboxImageInvalidationBuildArgs } from './imageInvalidation';
import { broadcastImageUpdated } from './progress';
import { sanitizeDockerNameSegment } from './dockerfileTemplates';

export function watchGlobalDockerfile(dockerfilePath: string): fs.FSWatcher {
  let rebuilding = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  return fs.watch(dockerfilePath, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (!fs.existsSync(dockerfilePath) || rebuilding) return;
      const newHash = crypto.createHash('sha256').update(fs.readFileSync(dockerfilePath, 'utf8')).digest('hex');
      if (newHash === getStore().get('meta').sandboxImageHash) return;

      eventLogger.info('docker', 'Dockerfile.sandbox changed, rebuilding base image in background', {
        imageName: GLOBAL_IMAGE_NAME,
      });
      rebuilding = true;
      try {
        await ensureImageBuilt(GLOBAL_IMAGE_NAME, dockerfilePath, undefined, {
          forceRebuild: true,
          buildArgs: getSandboxImageInvalidationBuildArgs(),
        });
        markSandboxImageBuilt(newHash);
        for (const proj of getAllProjects()) {
          if (proj.dockerfileHash) {
            saveProjectToDb({ ...proj, dockerfileHash: undefined });
          }
        }
        broadcastImageUpdated({ imageName: GLOBAL_IMAGE_NAME });
        eventLogger.info('docker', 'Base image rebuild complete — project images will rebuild on next thread start', {
          imageName: GLOBAL_IMAGE_NAME,
        });
      } catch (err) {
        eventLogger.error('docker', 'Base image background rebuild failed', { error: String(err) });
      } finally {
        rebuilding = false;
      }
    }, 500);
  });
}

export function watchDockerfile(
  projectId: string,
  dockerfilePath: string,
  projectPath: string,
  dockerfileWatchers: Map<string, fs.FSWatcher>,
  dockerfileRebuildingProjects: Set<string>
): void {
  let debounceTimer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(dockerfilePath, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (!fs.existsSync(dockerfilePath) || dockerfileRebuildingProjects.has(projectId)) return;
      const globalImageId = await getImageId(GLOBAL_IMAGE_NAME);
      const newHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(dockerfilePath, 'utf8'))
        .update(globalImageId ?? '')
        .digest('hex');
      const project = getProject(projectId);
      if (!project || newHash === project.dockerfileHash) return;

      const imageName = `agentos-project-${sanitizeDockerNameSegment(projectId)}:latest`;
      eventLogger.info('docker', 'Dockerfile.agentos changed, rebuilding image in background', {
        projectId,
        imageName,
      });
      dockerfileRebuildingProjects.add(projectId);
      try {
        await ensureImageBuilt(imageName, dockerfilePath, projectPath, { forceRebuild: true });
        saveProjectToDb({ ...project, dockerfileHash: newHash });
        broadcastImageUpdated({ imageName, projectId });
        eventLogger.info('docker', 'Dockerfile.agentos rebuild complete', { projectId, imageName });
      } catch (err) {
        eventLogger.error('docker', 'Dockerfile.agentos background rebuild failed', {
          projectId,
          error: String(err),
        });
      } finally {
        dockerfileRebuildingProjects.delete(projectId);
      }
    }, 500);
  });
  dockerfileWatchers.set(projectId, watcher);
}
