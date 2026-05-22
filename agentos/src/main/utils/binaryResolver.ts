import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function bundledCandidatePaths(binaryName: string): string[] {
  const archSuffix = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  const roots = app.isPackaged
    ? [path.join(process.resourcesPath, 'bin')]
    : [path.join(app.getAppPath(), 'resources', 'bin')];
  const names = [binaryName, ...(archSuffix ? [`${binaryName}-${archSuffix}`] : [])];
  return roots.flatMap((root) => names.map((name) => path.join(root, name)));
}

function candidatePaths(binaryName: string): string[] {
  const envPaths = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, binaryName));
  const home = os.homedir();
  const common = [
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
    `/bin/${binaryName}`,
    path.join(home, '.npm-global', 'bin', binaryName),
    path.join(home, '.npm', 'bin', binaryName),
  ];
  return [...bundledCandidatePaths(binaryName), ...envPaths, ...common];
}

function loginShell(): string {
  const shell = process.env.SHELL ?? '';
  const base = path.basename(shell);
  const known = ['bash', 'zsh', 'fish', 'sh'];
  return known.includes(base) ? shell : '/bin/sh';
}

export async function resolveBinary(binaryName: string): Promise<string> {
  for (const candidate of bundledCandidatePaths(binaryName)) {
    if (isExecutable(candidate)) return candidate;
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where', [binaryName], { encoding: 'utf8' });
      const resolved = stdout.trim().split('\n')[0];
      if (resolved && isExecutable(resolved)) return resolved;
    } catch {
      // continue to filesystem candidates
    }
  } else {
    try {
      const { stdout } = await execFileAsync('which', [binaryName], { encoding: 'utf8' });
      const resolved = stdout.trim().split('\n')[0];
      if (resolved && isExecutable(resolved)) return resolved;
    } catch {
      // continue to login shell fallback
    }

    try {
      const shell = loginShell();
      const { stdout } = await execFileAsync(shell, ['-lc', `command -v ${binaryName}`], { encoding: 'utf8' });
      const resolved = stdout.trim().split('\n')[0];
      if (resolved && isExecutable(resolved)) return resolved;
    } catch {
      // continue to filesystem candidates
    }
  }

  for (const candidate of candidatePaths(binaryName)) {
    if (isExecutable(candidate)) return candidate;
  }

  throw new Error(`${binaryName} binary not found (checked PATH, login shell, and common install paths)`);
}
