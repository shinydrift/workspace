/**
 * Normalize a user-supplied project subdirectory into a clean repo-root-relative
 * POSIX path, or undefined when empty. The repo root is always the mount source
 * (`/workspace`); `subdir` only shifts the working directory *within* it.
 *
 * Throws on paths that escape the repo root (absolute paths or `..` segments) so
 * callers reject them at the boundary rather than mounting an unintended location.
 */
export function normalizeSubdir(input: string | null | undefined): string | undefined {
  if (input == null) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error(`Project subdirectory must be relative, not absolute: "${input}"`);
  }

  const segments = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) return undefined;
  if (segments.some((s) => s === '..')) {
    throw new Error(`Project subdirectory must stay within the repo root: "${input}"`);
  }
  return segments.join('/');
}
