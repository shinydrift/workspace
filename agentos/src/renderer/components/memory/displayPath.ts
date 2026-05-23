// Code-source chunks store their path as `code:${absPath}` (see main/memory/sync/core.ts).
// Strip the sentinel for any user-facing display.
export function displayPath(path: string): string {
  return path.startsWith('code:') ? path.slice(5) : path;
}
