import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getProject } from '../threads/db';
import {
  isDockerAvailable,
  waitForDocker,
  ensureThreadImages,
  computeContainerConfigHash,
  handleExistingContainerForStart,
} from '../utils/docker';
import { ensureGlobalDockerfile } from '../utils/docker/dockerfileTemplates';
import { resolveStartConfig } from './threadStartConfig';
import type { ResolvedStartConfig } from './threadStartConfig';
import { seedCodexAuthFromHost, seedGeminiAuthFromHost, refreshCodexAuthIfNeeded } from './threadAuth';
import { PROVIDER_CONFIGS } from '../utils/providerConfig';
import { buildThreadLaunchArgs } from './threadLaunchBuilder';
import { memoryMcpServer } from '../integrations/memoryMcpServer';
import { threadMcpServer } from '../integrations/threadMcpServer';
import { councilMcpServer } from '../integrations/councilMcpServer';
import { kanbanMcpServer } from '../kanban/mcpServer';
import { recordingsMcpServer } from '../integrations/recordingsMcpServer';
import { PtyProcess } from './PtyProcess';
import { removeContainer as removeDockerContainer } from '../utils/dockerCleanup';
import { eventLogger } from '../utils/eventLog';
import type { ContainerManager } from './ContainerManager';
import type { ThreadOutputManager } from './threadOutput';
import type { LaunchMode } from './turnExecution';
import type { Thread, Provider, AppSettings } from '../../shared/types';

export type ThreadStartupResult = {
  proc: PtyProcess;
  launchMode: LaunchMode;
  imageName: string;
  configHash: string;
  containerName: string;
  startConfig: ResolvedStartConfig;
};

function resolveMcpPort(server: { actualPort: number | null }, name: string, threadId: string): number {
  if (server.actualPort === null) {
    eventLogger.warn('thread', `${name} MCP server port not yet bound — agent MCP URLs will be invalid`, {
      server: name,
      threadId,
    });
    return 0;
  }
  return server.actualPort;
}

/**
 * Handles the heavy lifting of starting a thread: Docker checks, image building,
 * config resolution, auth seeding, launch args, and PTY creation.
 * Returns the ready-to-use proc and launchMode for ThreadManager to wire up events.
 */
export async function prepareThreadStartup(
  threadId: string,
  stored: Omit<Thread, 'logBuffer'>,
  provider: Provider,
  settings: AppSettings,
  options: { forceClaudePlainText?: boolean; fallbackTried?: boolean } | undefined,
  deps: {
    containers: ContainerManager;
    sessionsDataDir: string;
    output: ThreadOutputManager;
  }
): Promise<ThreadStartupResult> {
  const { containers, sessionsDataDir, output } = deps;

  // 1. Config resolution first — it has no Docker dependency and resolves `runOnHost`,
  //    which decides whether any of the Docker setup below runs at all.
  const startConfig = await resolveStartConfig(threadId, stored, provider, settings, options);
  const { effectiveSandbox, providerArgs, extraReadonlyMounts, useHeadless, useClaudeStreamJson, runOnHost } =
    startConfig;

  const seccompProfilePath = app.isPackaged
    ? path.join(process.resourcesPath, 'seccomp-sandbox.json')
    : path.join(app.getAppPath(), 'resources', 'seccomp-sandbox.json');

  // 2. Docker availability + image building — skipped entirely on host execution.
  let imageName = '';
  let projectDockerfileHash = '';
  if (!runOnHost) {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      eventLogger.warn('docker', 'Docker unavailable, attempting to start...', { threadId });
      output.appendSystemLogEntry(threadId, '[docker] Starting Docker Desktop, please wait...');
      const started = await waitForDocker();
      if (!started) {
        eventLogger.error('docker', 'Docker is unavailable for thread start', { threadId });
        throw new Error('Docker is not available. Open or install Docker Desktop, then recheck in AgentOS and retry.');
      }
      eventLogger.info('docker', 'Docker started successfully', { threadId });
    }

    const bundledDockerfilePath = app.isPackaged
      ? path.join(process.resourcesPath, 'Dockerfile.sandbox')
      : path.join(app.getAppPath(), 'resources', 'Dockerfile.sandbox');
    const globalDockerfilePath = ensureGlobalDockerfile(bundledDockerfilePath);

    const project = stored.projectId ? getProject(stored.projectId) : null;

    const images = await ensureThreadImages({
      provider,
      project,
      globalDockerfilePath,
      dockerfileWatchers: containers.dockerfileWatchers,
      dockerfileRebuildingProjects: containers.dockerfileRebuildingProjects,
      globalDockerfileWatcherRef: containers.globalDockerfileWatcherRef,
    });
    imageName = images.imageName;
    projectDockerfileHash = images.projectDockerfileHash;

    await containers.prune().catch((err) => {
      eventLogger.warn('thread', 'prune containers failed', { error: String(err) });
    });
  }

  // Compute secondary provider auth mount paths upfront so they can be included in the
  // config hash — ensuring containers are recreated when the mount layout changes.
  // Seeding (file copies) happens after handleExistingContainerForStart below.
  const userHome = app.getPath('home');
  const sessionDataDir = provider === 'claude' ? path.join(userHome, '.claude') : path.join(sessionsDataDir, threadId);

  // Bind mounts only matter for Docker. On host the CLIs read the user's real ~/.claude,
  // ~/.codex, ~/.gemini directly, so there is nothing to mount.
  const secondaryAuthMounts: Array<{ hostPath: string; containerPath: string; readOnly: boolean }> = [];
  if (!runOnHost) {
    for (const p of ['claude', 'codex', 'gemini', 'pi'] as const) {
      if (p === provider) continue;
      const containerPath = PROVIDER_CONFIGS[p].sessionConfigDir;
      let hostPath: string;
      if (p === 'claude') {
        hostPath = path.join(userHome, '.claude');
        if (!fs.existsSync(hostPath)) continue; // skip if user hasn't set up Claude
      } else {
        hostPath = path.join(sessionsDataDir, `${threadId}-${p}`);
      }
      secondaryAuthMounts.push({ hostPath, containerPath, readOnly: false });
    }
  }

  // The interactive claude TUI requires ~/.claude.json (a sibling file, not inside
  // ~/.claude/) to find the user's auth and skip the onboarding flow. Headless
  // claude is fine without it because it relies on CLAUDE_CODE_OAUTH_TOKEN env.
  // Mount it read-write so claude can record per-project trust decisions; harmless
  // for headless threads if present. (Docker only — host reads it in place.)
  const claudeJsonHost = path.join(userHome, '.claude.json');
  const claudeJsonMount =
    !runOnHost && provider === 'claude' && fs.existsSync(claudeJsonHost) && fs.statSync(claudeJsonHost).isFile()
      ? [{ hostPath: claudeJsonHost, containerPath: '/home/agent/.claude.json', readOnly: false }]
      : [];

  const allExtraReadonlyMounts = [...extraReadonlyMounts, ...secondaryAuthMounts, ...claudeJsonMount];

  const containerName = `agentos-session-${threadId}`;
  const configHash = computeContainerConfigHash({
    threadId,
    workingDirectory: stored.workingDirectory,
    imageName,
    provider,
    sandbox: effectiveSandbox,
    providerArgs,
    extraReadonlyMounts: allExtraReadonlyMounts,
    dockerfileHash: projectDockerfileHash,
  });

  if (!runOnHost) {
    await handleExistingContainerForStart({
      threadId,
      containerName,
      expectedConfigHash: configHash,
    });
  } else if (await isDockerAvailable()) {
    // The thread may have previously run under Docker and just been switched to host mode.
    // Best-effort remove any leftover container so it isn't orphaned (it would otherwise keep
    // running with the working-dir bind mount, since host teardown never calls stopContainer).
    await removeDockerContainer(containerName).catch((err) => {
      eventLogger.warn('docker', 'failed to remove stale container on host start', {
        threadId,
        error: String(err),
      });
    });
  }
  // Session files live in sessionDataDir (host bind-mount) and survive container removal.
  // Do NOT clear session IDs here — --resume will work with a fresh container mounting
  // the same dir. The retry logic in execHeadlessTurn handles truly stale IDs.

  // 4. Provider auth seeding into sessionDataDir — only needed for the Docker bind mount.
  //    On host the CLIs read the user's real ~/.codex / ~/.gemini directly.
  fs.mkdirSync(sessionDataDir, { recursive: true });

  if (!runOnHost && provider === 'codex' && !startConfig.apiKey) {
    await refreshCodexAuthIfNeeded(userHome);
    const seeded = seedCodexAuthFromHost(userHome, sessionDataDir);
    if (seeded) eventLogger.info('auth', 'Seeded Codex auth from host profile', { threadId });
  }
  if (!runOnHost && provider === 'gemini' && !startConfig.apiKey) {
    const seeded = seedGeminiAuthFromHost(userHome, sessionDataDir);
    if (seeded) eventLogger.info('auth', 'Seeded Gemini auth from host profile', { threadId });
  }

  // Preemptively seed auth for all non-primary providers so that council child threads
  // can exec into this container using any provider without per-dispatch auth setup.
  // secondaryAuthMounts is empty on host, so this loop is a no-op there.
  for (const mount of secondaryAuthMounts) {
    if (mount.containerPath === PROVIDER_CONFIGS.claude.sessionConfigDir) continue; // ~/.claude managed by Claude primary
    fs.mkdirSync(mount.hostPath, { recursive: true });
    if (mount.containerPath === PROVIDER_CONFIGS.codex.sessionConfigDir) {
      await refreshCodexAuthIfNeeded(userHome);
      const seeded = seedCodexAuthFromHost(userHome, mount.hostPath);
      if (seeded) eventLogger.info('auth', 'Seeded Codex auth for secondary provider mount', { threadId });
    } else if (mount.containerPath === PROVIDER_CONFIGS.gemini.sessionConfigDir) {
      const seeded = seedGeminiAuthFromHost(userHome, mount.hostPath);
      if (seeded) eventLogger.info('auth', 'Seeded Gemini auth for secondary provider mount', { threadId });
    }
  }

  // 5. Launch args + PTY creation
  const {
    command,
    args,
    effectiveSystemPrompt,
    launchEnv,
    memoryMcpUrl,
    threadMcpUrl,
    councilMcpUrl,
    kanbanMcpUrl,
    recordingsMcpUrl,
  } = await buildThreadLaunchArgs({
    threadId,
    stored,
    provider,
    imageName,
    apiKey: startConfig.apiKey,
    effectiveSandbox,
    runOnHost,
    providerArgs,
    extraReadonlyMounts: allExtraReadonlyMounts,
    configHash,
    injectionPayload: startConfig.injectionPayload,
    useHeadless,
    sessionDataDir,
    memoryMcpPort: resolveMcpPort(memoryMcpServer, 'memory', threadId),
    threadMcpPort: resolveMcpPort(threadMcpServer, 'thread', threadId),
    councilMcpPort: resolveMcpPort(councilMcpServer, 'council', threadId),
    kanbanMcpPort: resolveMcpPort(kanbanMcpServer, 'kanban', threadId),
    recordingsMcpPort: resolveMcpPort(recordingsMcpServer, 'recordings', threadId),
    tailscaleAuthKey: startConfig.projectConfigResult.config?.tailscale?.authKey ?? settings.tailscale?.authKey,
    tailscaleFunnel: startConfig.projectConfigResult.config?.tailscale?.funnel ?? settings.tailscale?.funnel,
    githubToken: startConfig.projectConfigResult.config?.apiKeys?.github ?? settings.apiKeys?.github,
    envSafelist: [...(settings.env?.safelist ?? []), ...(startConfig.projectConfigResult.config?.env?.safelist ?? [])],
    envVars: {
      ...(settings.env?.vars ?? {}),
      ...(startConfig.projectConfigResult.config?.env?.vars ?? {}),
      // backendEnv is last: must win over user envVars so backend routing is authoritative
      ...startConfig.backendEnv,
    },
    seccompProfilePath,
    providerCommandOverrides: settings.agents.commandOverrides,
  });

  if (runOnHost) {
    eventLogger.info('thread', 'Starting thread on host (no sandbox)', { threadId, provider });
  } else {
    const mounts = args.reduce<string[]>((acc, v, i) => {
      if (args[i - 1] === '-v') acc.push(v);
      return acc;
    }, []);
    eventLogger.info('docker', 'Starting new container', { threadId, imageName, mounts });
  }

  // Host: keep-alive placeholder needs no env; per-turn processes get launchEnv via headlessRunner.
  const proc = new PtyProcess(command, args, stored.workingDirectory);

  const launchMode: LaunchMode = {
    claudeStreamJson: useClaudeStreamJson,
    fallbackTried: Boolean(options?.fallbackTried),
    headless: useHeadless,
    runOnHost,
    hostEnv: launchEnv,
    systemPrompt: useHeadless ? (effectiveSystemPrompt ?? null) : null,
    memoryMcpUrl,
    threadMcpUrl,
    councilMcpUrl,
    kanbanMcpUrl,
    recordingsMcpUrl,
  };

  return { proc, launchMode, imageName, configHash, containerName, startConfig };
}
