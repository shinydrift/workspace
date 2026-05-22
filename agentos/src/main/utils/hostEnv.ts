import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Returns the user's full shell environment by spawning a login shell.
 * Uses $SHELL -l -c env (reads .zprofile, .zshenv, .bash_profile, etc.).
 * Falls back to process.env on any error.
 */
export async function getHostShellEnv(): Promise<Record<string, string>> {
  const shell = process.env.SHELL ?? '/bin/sh';
  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'env'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return parseEnvOutput(stdout);
  } catch {
    return Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
  }
}

/**
 * Filters an env record by a list of patterns.
 * Supports exact names ('GITHUB_TOKEN') and glob-style wildcards ('*_TOKEN', 'MY_*').
 */
export function filterEnvBySafelist(env: Record<string, string>, patterns: string[]): Record<string, string> {
  if (patterns.length === 0) return {};
  const regexes = patterns.map(patternToRegex);
  return Object.fromEntries(Object.entries(env).filter(([key]) => regexes.some((re) => re.test(key))));
}

function patternToRegex(pattern: string): RegExp {
  // Escape regex metacharacters except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Convert glob wildcards
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`);
}

function parseEnvOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx);
    const value = line.slice(eqIdx + 1);
    if (key) result[key] = value;
  }
  return result;
}
