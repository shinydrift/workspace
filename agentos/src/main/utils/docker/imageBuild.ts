import crypto from 'crypto';
import fs from 'fs';
import type { Provider, SavedProject } from '../../../shared/types';
import { PROVIDER_CONFIGS } from '../providerConfig';
import { saveProjectToDb } from '../../threads/db';
import { eventLogger } from '../eventLog';
import { getStore } from '../../store';
import { ensureImageBuilt, getImageId, isImageBuilt, imageHasBinary, imageBinaryVersionAtLeast } from './client';
import { GLOBAL_IMAGE_NAME, MIN_CODEX_CLI_VERSION, markSandboxImageBuilt } from './constants';
import {
  getSandboxImageInvalidationBuildArgs,
  shouldForceSandboxImageRebuild,
  SANDBOX_IMAGE_REBUILD_INTERVAL_MS,
} from './imageInvalidation';
import {
  ensureProjectDockerfile,
  computeProjectDockerfileHash,
  sanitizeDockerNameSegment,
} from './dockerfileTemplates';
import { watchDockerfile, watchGlobalDockerfile } from './watchers';

export async function ensureProjectImage(
  project: SavedProject,
  provider: Provider,
  globalImageId: string | null,
  dockerfileWatchers: Map<string, fs.FSWatcher>,
  dockerfileRebuildingProjects: Set<string>
): Promise<{ imageName: string; dockerfileHash: string | null }> {
  const imageName = `agentos-project-${sanitizeDockerNameSegment(project.id)}:latest`;

  const { projectDockerfilePath, forceRebuild: templateForceRebuild } = ensureProjectDockerfile(project, provider);
  let forceRebuild = templateForceRebuild;

  const dockerfileHash = computeProjectDockerfileHash(projectDockerfilePath, globalImageId);

  if (!forceRebuild && dockerfileHash && project.dockerfileHash && dockerfileHash !== project.dockerfileHash) {
    forceRebuild = true;
    eventLogger.info('docker', 'Rebuilding project image: Dockerfile.agentos changed', {
      projectId: project.id,
      projectPath: project.path,
      imageName,
    });
  }

  if (!forceRebuild && provider !== 'claude' && (await isImageBuilt(imageName))) {
    const requiredBinary = PROVIDER_CONFIGS[provider].binaryName;
    const hasRequiredBinary = await imageHasBinary(imageName, requiredBinary);
    if (!hasRequiredBinary) {
      forceRebuild = true;
      eventLogger.warn('docker', 'Rebuilding project image: missing provider CLI binary', {
        projectId: project.id,
        projectPath: project.path,
        provider,
        imageName,
        requiredBinary,
      });
    }
  }

  if (!forceRebuild && provider === 'codex' && (await isImageBuilt(imageName))) {
    const codexVersionOk = await imageBinaryVersionAtLeast(
      imageName,
      PROVIDER_CONFIGS.codex.binaryName,
      MIN_CODEX_CLI_VERSION
    );
    if (!codexVersionOk) {
      forceRebuild = true;
      eventLogger.warn('docker', 'Rebuilding project image: Codex CLI version is outdated', {
        projectId: project.id,
        projectPath: project.path,
        provider,
        imageName,
        minCodexVersion: MIN_CODEX_CLI_VERSION,
      });
    }
  }

  await ensureImageBuilt(imageName, projectDockerfilePath, project.path, { forceRebuild });

  const hashChanged = dockerfileHash !== null && project.dockerfileHash !== dockerfileHash;
  if (hashChanged) {
    saveProjectToDb({ ...project, dockerfileHash });
  }

  if (!dockerfileWatchers.has(project.id) && fs.existsSync(projectDockerfilePath)) {
    watchDockerfile(project.id, projectDockerfilePath, project.path, dockerfileWatchers, dockerfileRebuildingProjects);
  }

  return { imageName, dockerfileHash };
}

export async function ensureThreadImages(params: {
  provider: Provider;
  project: SavedProject | null;
  globalDockerfilePath: string;
  dockerfileWatchers: Map<string, fs.FSWatcher>;
  dockerfileRebuildingProjects: Set<string>;
  globalDockerfileWatcherRef: { current: fs.FSWatcher | null };
}): Promise<{ imageName: string; projectDockerfileHash: string | null }> {
  const {
    provider,
    project,
    globalDockerfilePath,
    dockerfileWatchers,
    dockerfileRebuildingProjects,
    globalDockerfileWatcherRef,
  } = params;

  const sandboxHash = crypto.createHash('sha256').update(fs.readFileSync(globalDockerfilePath, 'utf8')).digest('hex');
  const meta = getStore().get('meta');
  const storedSandboxHash = meta.sandboxImageHash;
  const globalImageAlreadyBuilt = await isImageBuilt(GLOBAL_IMAGE_NAME);
  const rebuildDecision = shouldForceSandboxImageRebuild({
    sandboxHash,
    storedSandboxHash,
    imageBuilt: globalImageAlreadyBuilt,
    lastBuiltAt: meta.sandboxImageBuiltAt,
  });

  let forceGlobalRebuild = rebuildDecision.forceRebuild;
  if (rebuildDecision.reason === 'dockerfile_changed') {
    eventLogger.info('docker', 'Rebuilding global sandbox image: Dockerfile.sandbox changed', {
      imageName: GLOBAL_IMAGE_NAME,
    });
  }
  if (rebuildDecision.reason === 'daily_interval_elapsed') {
    eventLogger.info('docker', 'Rebuilding global sandbox image: daily invalidation interval elapsed', {
      imageName: GLOBAL_IMAGE_NAME,
      intervalMs: SANDBOX_IMAGE_REBUILD_INTERVAL_MS,
      lastBuiltAt: meta.sandboxImageBuiltAt,
    });
  }

  if (!forceGlobalRebuild && provider === 'codex' && globalImageAlreadyBuilt) {
    const codexVersionOk = await imageBinaryVersionAtLeast(
      GLOBAL_IMAGE_NAME,
      PROVIDER_CONFIGS.codex.binaryName,
      MIN_CODEX_CLI_VERSION
    );
    forceGlobalRebuild = !codexVersionOk;
    if (forceGlobalRebuild) {
      eventLogger.warn('docker', 'Rebuilding global sandbox image: Codex CLI version is outdated', {
        imageName: GLOBAL_IMAGE_NAME,
        minCodexVersion: MIN_CODEX_CLI_VERSION,
      });
    }
  }

  await ensureImageBuilt(GLOBAL_IMAGE_NAME, globalDockerfilePath, undefined, {
    forceRebuild: forceGlobalRebuild,
    buildArgs: forceGlobalRebuild ? getSandboxImageInvalidationBuildArgs() : undefined,
  });

  if (
    forceGlobalRebuild ||
    !globalImageAlreadyBuilt ||
    storedSandboxHash !== sandboxHash ||
    meta.sandboxImageBuiltAt === undefined
  ) {
    markSandboxImageBuilt(sandboxHash);
  }

  const globalImageId = await getImageId(GLOBAL_IMAGE_NAME);

  if (globalDockerfileWatcherRef.current === null) {
    globalDockerfileWatcherRef.current = watchGlobalDockerfile(globalDockerfilePath);
  }

  let imageName: string;
  let projectDockerfileHash: string | null = null;
  if (project) {
    ({ imageName, dockerfileHash: projectDockerfileHash } = await ensureProjectImage(
      project,
      provider,
      globalImageId,
      dockerfileWatchers,
      dockerfileRebuildingProjects
    ));
  } else {
    imageName = GLOBAL_IMAGE_NAME;
  }

  return { imageName, projectDockerfileHash };
}
