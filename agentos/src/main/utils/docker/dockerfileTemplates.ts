import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Provider, SavedProject } from '../../../shared/types';
import { eventLogger } from '../eventLog';
import { GLOBAL_IMAGE_NAME } from './constants';

/** Converts a project ID into a valid Docker name segment (lowercase alnum + hyphens). */
export function sanitizeDockerNameSegment(id: string): string {
  return (
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

/**
 * Seeds the base sandbox build context into ~/.agentos/ from the bundled templates,
 * then returns the path to the home-dir Dockerfile. The build context is the
 * Dockerfile's directory, and Dockerfile.sandbox `COPY`s entrypoint.sh, so both files
 * are seeded together to keep ~/.agentos a self-contained, user-editable context.
 * Never overwrites an existing copy, so user edits persist across app updates.
 */
export function ensureGlobalDockerfile(bundledDockerfilePath: string): string {
  const agentosDir = path.join(os.homedir(), '.agentos');
  const bundledDir = path.dirname(bundledDockerfilePath);

  for (const name of ['Dockerfile.sandbox', 'entrypoint.sh']) {
    const target = path.join(agentosDir, name);
    if (!fs.existsSync(target)) {
      const source = path.join(bundledDir, name);
      fs.mkdirSync(agentosDir, { recursive: true });
      fs.copyFileSync(source, target);
      eventLogger.info('docker', `Seeded ~/.agentos/${name} from bundled template`, { source, target });
    }
  }

  return path.join(agentosDir, 'Dockerfile.sandbox');
}

export function computeProjectDockerfileHash(
  projectDockerfilePath: string,
  globalImageId: string | null
): string | null {
  if (!fs.existsSync(projectDockerfilePath)) return null;
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(projectDockerfilePath, 'utf8'))
    .update(globalImageId ?? '')
    .digest('hex');
}

/**
 * Ensures Dockerfile.agentos exists at project.path/Dockerfile.agentos.
 * Creates a minimal template if absent; migrates the legacy Claude-only template when
 * a non-Claude provider is active. Returns whether a force-rebuild is required.
 */
export function ensureProjectDockerfile(
  project: SavedProject,
  provider: Provider
): { projectDockerfilePath: string; forceRebuild: boolean } {
  const projectDockerfilePath = path.join(project.path, 'Dockerfile.agentos');
  let forceRebuild = false;

  if (!fs.existsSync(projectDockerfilePath)) {
    fs.writeFileSync(projectDockerfilePath, `FROM ${GLOBAL_IMAGE_NAME}\n# Add project-specific dependencies below\n`);
    eventLogger.info('docker', 'Initialized Dockerfile.agentos', {
      projectId: project.id,
      projectPath: project.path,
    });
  } else if (provider !== 'claude') {
    const dockerfile = fs.readFileSync(projectDockerfilePath, 'utf8');
    const isLegacyClaudeTemplate =
      /FROM\s+node:20-slim/i.test(dockerfile) &&
      /npm\s+install\s+-g\s+@anthropic-ai\/claude-code/i.test(dockerfile) &&
      !/@openai\/codex/i.test(dockerfile) &&
      !/@google\/gemini-cli/i.test(dockerfile) &&
      /ENTRYPOINT\s*\[\s*"claude"\s*\]/i.test(dockerfile);

    if (isLegacyClaudeTemplate) {
      fs.writeFileSync(projectDockerfilePath, `FROM ${GLOBAL_IMAGE_NAME}\n# Add project-specific dependencies below\n`);
      forceRebuild = true;
      eventLogger.warn('docker', 'Migrated legacy Dockerfile.agentos to multi-provider template', {
        projectId: project.id,
        projectPath: project.path,
        provider,
      });
    }
  }

  return { projectDockerfilePath, forceRebuild };
}
