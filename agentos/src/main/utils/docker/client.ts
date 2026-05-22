import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { eventLogger } from '../eventLog';
import { broadcastProgress } from './progress';

const execFileAsync = promisify(execFile);

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

export async function isImageBuilt(imageName: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['image', 'inspect', imageName], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

export async function getImageId(imageName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['image', 'inspect', '--format', '{{.Id}}', imageName], {
      encoding: 'utf8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function imageHasBinary(imageName: string, binaryName: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['run', '--rm', '--entrypoint', 'which', imageName, binaryName], {
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

function parseSemver(input: string): [number, number, number] | null {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export async function getImageBinaryVersion(imageName: string, binaryName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['run', '--rm', imageName, binaryName, '--version'], {
      encoding: 'utf8',
    });
    const parsed = parseSemver(stdout.trim());
    if (!parsed) return null;
    return `${parsed[0]}.${parsed[1]}.${parsed[2]}`;
  } catch {
    return null;
  }
}

export async function imageBinaryVersionAtLeast(
  imageName: string,
  binaryName: string,
  minVersion: string
): Promise<boolean> {
  const current = await getImageBinaryVersion(imageName, binaryName);
  const currentParsed = current ? parseSemver(current) : null;
  const minParsed = parseSemver(minVersion);
  if (!currentParsed || !minParsed) return false;
  if (currentParsed[0] !== minParsed[0]) return currentParsed[0] > minParsed[0];
  if (currentParsed[1] !== minParsed[1]) return currentParsed[1] > minParsed[1];
  return currentParsed[2] >= minParsed[2];
}

export async function waitForDocker(timeoutMs = 60_000): Promise<boolean> {
  try {
    await execFileAsync('open', ['-a', 'Docker'], { encoding: 'utf8' });
    eventLogger.info('docker', 'Launched Docker Desktop, waiting for daemon...');
  } catch {
    // Not macOS or Docker Desktop not installed — daemon may still come up on its own
  }

  broadcastProgress('Waiting for Docker daemon...');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    if (await isDockerAvailable()) return true;
  }
  return false;
}

// Short-timeout inspect for pre-dispatch liveness checks. Bounded so a wedged docker
// daemon can't stall every user turn on the ensureHealthy probe. Returns null when the
// container doesn't exist, the inspect fails, or the timeout fires — callers treat all
// three the same as a non-running container and trigger a restart.
export async function getContainerStatus(containerName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{.State.Status}}', containerName], {
      encoding: 'utf8',
      timeout: 2_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function waitForContainerRunning(containerName: string, maxWaitMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{.State.Status}}', containerName], {
        encoding: 'utf8',
      });
      const status = stdout.trim();
      if (status === 'running') return;
      if (status === 'exited' || status === 'dead') {
        throw new Error(`Container ${containerName} exited unexpectedly (status: ${status})`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('exited unexpectedly')) throw err;
      // container not yet created — keep polling
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Container ${containerName} did not start within ${maxWaitMs}ms`);
}

export async function ensureImageBuilt(
  imageName: string,
  dockerfilePath: string,
  buildContext?: string,
  opts: { forceRebuild?: boolean; buildArgs?: Record<string, string> } = {}
): Promise<void> {
  if (!opts.forceRebuild && (await isImageBuilt(imageName))) return;

  const context = buildContext ?? path.dirname(dockerfilePath);
  const buildArgsList = Object.entries(opts.buildArgs ?? {}).flatMap(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid Docker build arg name: ${key}`);
    return ['--build-arg', `${key}=${value}`];
  });

  eventLogger.info('docker', `Building Docker image ${imageName}`, { imageName, context });
  broadcastProgress(`Building Docker image (first-time setup)...`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', ['build', ...buildArgsList, '-t', imageName, '-f', dockerfilePath, context]);

    proc.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      eventLogger.debug('docker', msg, { imageName, stream: 'stdout' });
      broadcastProgress(msg);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      eventLogger.warn('docker', msg, { imageName, stream: 'stderr' });
      broadcastProgress(msg);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        eventLogger.info('docker', `Docker image built successfully: ${imageName}`);
        broadcastProgress('Docker image built successfully.');
        resolve();
      } else {
        eventLogger.error('docker', `Docker image build failed: ${imageName}`, { exitCode: code });
        reject(new Error(`docker build failed with code ${code}`));
      }
    });
  });
}
