import fs from 'fs';
import path from 'path';

/**
 * A Claude Code session transcript that exists on disk under ~/.claude/projects but may not
 * be owned by any AgentOS thread yet (i.e. a raw `claude` run started outside the app).
 */
export interface ExternalSessionInfo {
  sessionId: string;
  jsonlPath: string;
  /** The cwd the external `claude` ran in, read from the transcript itself (see probeCwd). */
  cwd: string | null;
  mtimeMs: number;
}

// The cwd is recorded on every transcript entry, so it is almost always on the first line.
// Read a small head window instead of the whole (potentially multi-MB) file just to find it.
const CWD_PROBE_BYTES = 16 * 1024;

function probeCwd(jsonlPath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(jsonlPath, 'r');
    const buf = Buffer.alloc(CWD_PROBE_BYTES);
    const bytes = fs.readSync(fd, buf, 0, CWD_PROBE_BYTES, 0);
    const text = buf.toString('utf8', 0, bytes);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
      } catch {
        // A truncated trailing line inside the probe window — ignore; cwd is on earlier lines.
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Enumerate every session transcript under ~/.claude/projects. Deduplication against threads
 * AgentOS already owns is the caller's job (via claudeSessionId); this is a pure filesystem scan.
 */
export function scanExternalSessions(claudeDataDir: string): ExternalSessionInfo[] {
  const projectsDir = path.join(claudeDataDir, 'projects');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return [];
  }
  const out: ExternalSessionInfo[] = [];
  for (const dir of dirs) {
    const abs = path.join(projectsDir, dir);
    let files: string[];
    try {
      if (!fs.statSync(abs).isDirectory()) continue;
      files = fs.readdirSync(abs).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const jsonlPath = path.join(abs, file);
      let mtimeMs: number;
      try {
        mtimeMs = fs.statSync(jsonlPath).mtimeMs;
      } catch {
        continue;
      }
      out.push({ sessionId: path.basename(file, '.jsonl'), jsonlPath, cwd: probeCwd(jsonlPath), mtimeMs });
    }
  }
  return out;
}
