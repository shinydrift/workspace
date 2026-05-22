import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Reads all bundled SKILL.md files and returns a formatted system prompt section
 * for injection into non-Claude providers (Codex, Gemini) which don't support
 * native plugin formats.
 *
 * Returns null if no skills are found or the directory doesn't exist.
 */
export async function readBundledSkillsPrompt(bundledSkillsDir: string): Promise<string | null> {
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fs.readdir(bundledSkillsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const skills: Array<{ name: string; description: string; body: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcPath = path.join(bundledSkillsDir, entry.name, 'SKILL.md');
    try {
      const raw = await fs.readFile(srcPath, 'utf8');
      const parsed = parseSkillMd(raw);
      if (parsed) skills.push(parsed);
    } catch {
      // ignore invalid entries
    }
  }

  if (skills.length === 0) return null;

  const lines = [
    '## Available Skills',
    '',
    'The following skill workflows are available. Follow them when performing the relevant tasks.',
  ];
  for (const skill of skills) {
    lines.push('', `### ${skill.name}`, `_${skill.description}_`, '', skill.body);
  }
  return lines.join('\n');
}

function parseFrontmatter(raw: string): { name: string; description: string; body: string } | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const [, frontmatter, bodyRaw] = fmMatch;
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim() ?? '';
  const description = descMatch?.[1]?.trim() ?? '';
  const body = bodyRaw.trim();
  if (!name) return null;
  return { name, description, body };
}

function parseSkillMd(raw: string): { name: string; description: string; body: string } | null {
  return parseFrontmatter(raw);
}

// Sentinel stored inside the user skills dir.
// JSON: { signature, owned }.
// signature = sorted comma list of "name:contentHash" pairs — detects both name changes and content changes.
// owned     = names AgentOS previously wrote — required so we never overwrite a user-installed skill.
const BUNDLED_SKILLS_SENTINEL = '.agentos-bundled-skills.json';
const LEGACY_PLUGIN_DIR_SEGMENTS = ['.claude', 'plugins', 'agentos-bundled'];

interface BundledSkillsSentinel {
  signature: string;
  owned: string[];
}

function contentHash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Copies AgentOS's bundled skills to ~/.claude/skills/<name>/SKILL.md, where Claude Code
 * auto-loads user-level skills so `/<skill-name>` resolves without plugin registration.
 *
 * Sentinel change-detection skips the sync when the bundled set and all content is unchanged.
 * A skill with a matching name that AgentOS didn't previously own is left untouched
 * (user-installed skills win). Also migrates away from the legacy plugin-style
 * install location, which Claude Code didn't actually load.
 * Source SKILL.md frontmatter is converted: metadata.agentos wrapper is stripped.
 */
export async function ensureBundledClaudeSkills(userHome: string, bundledSkillsDir: string): Promise<void> {
  // Migration: remove legacy plugin-style install location (dead path).
  const legacyPluginDir = path.join(userHome, ...LEGACY_PLUGIN_DIR_SEGMENTS);
  await fs.rm(legacyPluginDir, { recursive: true, force: true }).catch(() => {});

  const skillsDir = path.join(userHome, '.claude', 'skills');

  let bundledEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    bundledEntries = await fs.readdir(bundledSkillsDir, { withFileTypes: true });
  } catch {
    return;
  }

  const skillNames = bundledEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (skillNames.length === 0) return;

  // Read all source files first to compute content-based signature
  const skillContents = new Map<string, string>();
  for (const name of skillNames) {
    const srcPath = path.join(bundledSkillsDir, name, 'SKILL.md');
    try {
      skillContents.set(name, await fs.readFile(srcPath, 'utf8'));
    } catch {
      // skip unreadable bundled entries
    }
  }

  const validSkillNames = skillNames.filter((n) => skillContents.has(n));
  if (validSkillNames.length === 0) return;

  // Signature encodes both name and content so any change triggers a re-sync
  const currentSignature = validSkillNames.map((name) => `${name}:${contentHash(skillContents.get(name)!)}`).join(',');

  const sentinelPath = path.join(skillsDir, BUNDLED_SKILLS_SENTINEL);
  let previousOwned = new Set<string>();
  try {
    const stored = JSON.parse(await fs.readFile(sentinelPath, 'utf8')) as BundledSkillsSentinel;
    if (stored.signature === currentSignature) return;
    if (Array.isArray(stored.owned)) previousOwned = new Set(stored.owned);
  } catch {
    // sentinel missing, unreadable, or malformed — proceed with sync
  }

  // Preserve previous ownership for names still in the bundled set even if this run fails to write them
  const nextOwned = new Set(previousOwned);

  for (const name of validSkillNames) {
    const destDir = path.join(skillsDir, name);
    const destPath = path.join(destDir, 'SKILL.md');

    // Collision guard: if a SKILL.md exists at the destination and we didn't
    // put it there, it belongs to the user. Skip silently — overwriting would destroy their work.
    let destExists = false;
    try {
      await fs.access(destPath);
      destExists = true;
    } catch {
      /* destPath absent — safe to write */
    }
    if (destExists && !previousOwned.has(name)) continue;

    try {
      const raw = skillContents.get(name)!;
      const converted = convertToClaudeSkillFormat(raw);
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(destPath, converted, 'utf8');
      nextOwned.add(name);
    } catch {
      // Preserve ownership from previous run even if this write failed —
      // the name is still a bundled skill and should be updated on next startup
    }
  }

  // Remove ownership for names no longer in the bundled set
  for (const name of nextOwned) {
    if (!skillContents.has(name)) nextOwned.delete(name);
  }

  try {
    await fs.mkdir(skillsDir, { recursive: true });
    const sentinel: BundledSkillsSentinel = {
      signature: currentSignature,
      owned: [...nextOwned].sort(),
    };
    await fs.writeFile(sentinelPath, JSON.stringify(sentinel), 'utf8');
  } catch {
    // non-fatal — next startup will re-sync
  }
}

/**
 * Converts AgentOS's SKILL.md frontmatter (with metadata.agentos wrapper) to
 * Claude Code's native format (plain name + description, no agentos metadata).
 */
function convertToClaudeSkillFormat(raw: string): string {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return raw;

  const lines = ['---', `name: ${parsed.name}`, `description: ${parsed.description}`, '---', parsed.body];
  return `${lines.join('\n')}\n`;
}
