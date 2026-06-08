import { realpathSync } from 'fs';
import { join } from 'path';

const DEFAULT_MOUNT = '/workspace';

/**
 * Translate a sandbox container path (e.g. `/workspace/foo.txt`) to its host equivalent
 * under `hostWorkingDir`, then verify the realpath stays inside `hostWorkingDir`.
 *
 * Agents run in Docker containers where the project is bind-mounted at `containerMount`
 * (default `/workspace`). MCP servers run on the host where that mount path doesn't exist.
 * Any MCP tool that accepts a file path from a sandboxed agent should call this before
 * touching the filesystem.
 *
 * Errors reference only the container path — never the host path — so internal layout
 * doesn't leak back through tool results.
 */
export function translateContainerPath(
  filePath: string,
  hostWorkingDir: string,
  containerMount: string = DEFAULT_MOUNT
): string {
  if (filePath !== containerMount && !filePath.startsWith(containerMount + '/')) {
    throw new Error(`file_path must be under ${containerMount}`);
  }

  let root: string;
  try {
    root = realpathSync(hostWorkingDir);
  } catch {
    throw new Error(`Workspace directory unavailable for ${containerMount}`);
  }

  if (filePath === containerMount) return root;

  const rel = filePath.slice(containerMount.length + 1);
  let resolved: string;
  try {
    resolved = realpathSync(join(root, rel));
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (resolved !== root && !resolved.startsWith(root + '/')) {
    throw new Error(`file_path must be under ${containerMount}`);
  }
  return resolved;
}
