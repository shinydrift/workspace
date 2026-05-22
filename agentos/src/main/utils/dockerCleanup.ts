import { execFile } from 'child_process';
import { promisify } from 'util';

const execDockerFile = promisify(execFile);

export type DockerExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type DockerContainerInspect = {
  exists: boolean;
  running: boolean;
  image: string | null;
  labels: Record<string, string>;
};

export async function execDocker(args: string[], allowFailure = false): Promise<DockerExecResult> {
  try {
    const { stdout, stderr } = await execDockerFile('docker', args);
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number;
      message?: string;
    };
    const stdout = typeof err.stdout === 'string' ? err.stdout : (err.stdout?.toString('utf8') ?? '');
    const stderr = typeof err.stderr === 'string' ? err.stderr : (err.stderr?.toString('utf8') ?? '');
    const code = typeof err.code === 'number' ? err.code : 1;
    if (!allowFailure) {
      throw new Error(stderr.trim() || err.message || `docker ${args.join(' ')} failed`);
    }
    return { stdout, stderr, code };
  }
}

export async function inspectContainer(containerName: string): Promise<DockerContainerInspect> {
  const inspect = await execDocker(
    ['inspect', '-f', '{{.State.Running}}\t{{.Config.Image}}\t{{json .Config.Labels}}', containerName],
    true
  );
  if (inspect.code !== 0) {
    return { exists: false, running: false, image: null, labels: {} };
  }

  const raw = inspect.stdout.trim();
  const [runningRaw = 'false', imageRaw = '', labelsRaw = '{}'] = raw.split('\t');
  let labels: Record<string, string> = {};
  try {
    labels = JSON.parse(labelsRaw) as Record<string, string>;
  } catch {
    labels = {};
  }

  return {
    exists: true,
    running: runningRaw === 'true',
    image: imageRaw || null,
    labels,
  };
}

export async function removeContainer(containerName: string): Promise<void> {
  await execDocker(['rm', '-f', containerName], true);
}
