/**
 * Tests for utils/claudePlugins.ts — convertToClaudeSkillFormat and readBundledSkillsPrompt (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Inlined from claudePlugins.ts ─────────────────────────────────────────────

function convertToClaudeSkillFormat(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return raw;

  const [, frontmatterBlock, body] = fmMatch;
  const nameMatch = frontmatterBlock.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatterBlock.match(/^description:\s*(.+)$/m);

  const name = nameMatch?.[1]?.trim() ?? '';
  const description = descMatch?.[1]?.trim() ?? '';

  const lines = ['---', `name: ${name}`, `description: ${description}`, '---', body.trim()];
  return `${lines.join('\n')}\n`;
}

// ── tests ──────────────────────────────────────────────────────────────────────

test('preserves name and description, strips agentos metadata', () => {
  const raw = `---
name: my-skill
description: does something useful
metadata:
  agentos:
    foo: bar
---
# Body content here
`;
  const result = convertToClaudeSkillFormat(raw);
  assert.ok(result.includes('name: my-skill'));
  assert.ok(result.includes('description: does something useful'));
  assert.ok(!result.includes('metadata:'));
  assert.ok(!result.includes('agentos:'));
});

test('preserves body content', () => {
  const raw = `---
name: test-skill
description: test desc
---
Some body text
More content
`;
  const result = convertToClaudeSkillFormat(raw);
  assert.ok(result.includes('Some body text'));
  assert.ok(result.includes('More content'));
});

test('returns raw string unchanged when no frontmatter', () => {
  const raw = 'Just plain content without frontmatter';
  assert.equal(convertToClaudeSkillFormat(raw), raw);
});

test('handles missing name gracefully (empty string)', () => {
  const raw = `---
description: only desc
---
body
`;
  const result = convertToClaudeSkillFormat(raw);
  assert.ok(result.includes('name: '));
  assert.ok(result.includes('description: only desc'));
});

test('handles missing description gracefully (empty string)', () => {
  const raw = `---
name: only-name
---
body
`;
  const result = convertToClaudeSkillFormat(raw);
  assert.ok(result.includes('name: only-name'));
  assert.ok(result.includes('description: '));
});

test('output always ends with newline', () => {
  const raw = `---
name: x
description: y
---
body
`;
  const result = convertToClaudeSkillFormat(raw);
  assert.ok(result.endsWith('\n'));
});

test('output has exactly four frontmatter lines (---,name,description,---)', () => {
  const raw = `---
name: my-skill
description: my desc
extra: ignored
---
body text
`;
  const result = convertToClaudeSkillFormat(raw);
  const lines = result.split('\n');
  assert.equal(lines[0], '---');
  assert.ok(lines[1].startsWith('name:'));
  assert.ok(lines[2].startsWith('description:'));
  assert.equal(lines[3], '---');
});

test('trims whitespace from name and description', () => {
  const raw = `---
name:   padded-name
description:   padded desc
---
body
`;
  const result = convertToClaudeSkillFormat(raw);
  assert.ok(result.includes('name: padded-name'));
  assert.ok(result.includes('description: padded desc'));
});

// ── parseSkillMd (inlined from claudePlugins.ts) ──────────────────────────────

function parseSkillMd(raw) {
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

test('parseSkillMd returns name, description, and body', () => {
  const raw = `---
name: git
description: Safe git workflows
---
# Git Skill
Use explicit commands.
`;
  const result = parseSkillMd(raw);
  assert.equal(result.name, 'git');
  assert.equal(result.description, 'Safe git workflows');
  assert.ok(result.body.includes('Git Skill'));
});

test('parseSkillMd returns null when no frontmatter', () => {
  assert.equal(parseSkillMd('just plain text'), null);
});

test('parseSkillMd returns null when name is missing', () => {
  const raw = `---
description: no name here
---
body
`;
  assert.equal(parseSkillMd(raw), null);
});

test('parseSkillMd body does not include frontmatter metadata', () => {
  const raw = `---
name: test
description: desc
metadata:
  agentos:
    emoji: "🔧"
---
body content
`;
  const result = parseSkillMd(raw);
  assert.ok(result !== null);
  assert.ok(!result.body.includes('metadata'));
});

// ── readBundledSkillsPrompt (filesystem-based) ────────────────────────────────

async function buildTmpSkillsDir(skills) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-skills-test-'));
  for (const { name: skillName, content } of skills) {
    const skillDir = path.join(tmpDir, skillName);
    await fs.promises.mkdir(skillDir);
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  }
  return tmpDir;
}

// Inlined readBundledSkillsPrompt for testing
async function readBundledSkillsPromptInlined(bundledSkillsDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(bundledSkillsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcPath = path.join(bundledSkillsDir, entry.name, 'SKILL.md');
    try {
      const raw = await fs.promises.readFile(srcPath, 'utf8');
      const parsed = parseSkillMd(raw);
      if (parsed) skills.push(parsed);
    } catch {
      // ignore
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

test('readBundledSkillsPrompt returns null for missing directory', async () => {
  const result = await readBundledSkillsPromptInlined('/nonexistent/path/skills');
  assert.equal(result, null);
});

test('readBundledSkillsPrompt returns null for empty directory', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-skills-empty-'));
  try {
    const result = await readBundledSkillsPromptInlined(tmpDir);
    assert.equal(result, null);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true });
  }
});

test('readBundledSkillsPrompt includes skill name and body in output', async () => {
  const tmpDir = await buildTmpSkillsDir([
    {
      name: 'git',
      content: `---\nname: git\ndescription: Safe git workflows\n---\n# Git Skill\nUse explicit commands.\n`,
    },
  ]);
  try {
    const result = await readBundledSkillsPromptInlined(tmpDir);
    assert.ok(result !== null);
    assert.ok(result.includes('## Available Skills'));
    assert.ok(result.includes('### git'));
    assert.ok(result.includes('Safe git workflows'));
    assert.ok(result.includes('Git Skill'));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true });
  }
});

test('readBundledSkillsPrompt includes multiple skills', async () => {
  const tmpDir = await buildTmpSkillsDir([
    { name: 'git', content: `---\nname: git\ndescription: Git workflows\n---\nGit body\n` },
    { name: 'docker', content: `---\nname: docker\ndescription: Docker CLI\n---\nDocker body\n` },
  ]);
  try {
    const result = await readBundledSkillsPromptInlined(tmpDir);
    assert.ok(result.includes('### git'));
    assert.ok(result.includes('### docker'));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true });
  }
});

test('readBundledSkillsPrompt skips entries without valid SKILL.md', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-skills-skip-'));
  await fs.promises.mkdir(path.join(tmpDir, 'empty-skill'));
  const validDir = path.join(tmpDir, 'valid');
  await fs.promises.mkdir(validDir);
  await fs.promises.writeFile(
    path.join(validDir, 'SKILL.md'),
    `---\nname: valid\ndescription: valid skill\n---\nvalid body\n`
  );
  try {
    const result = await readBundledSkillsPromptInlined(tmpDir);
    assert.ok(result !== null);
    assert.ok(result.includes('### valid'));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true });
  }
});

// ── ensureBundledClaudeSkills (inlined) ───────────────────────────────────────

const BUNDLED_SKILLS_SENTINEL = '.agentos-bundled-skills.json';

async function ensureBundledClaudeSkillsInlined(userHome, bundledSkillsDir) {
  const legacyPluginDir = path.join(userHome, '.claude', 'plugins', 'agentos-bundled');
  await fs.promises.rm(legacyPluginDir, { recursive: true, force: true }).catch(() => {});

  const skillsDir = path.join(userHome, '.claude', 'skills');

  let bundledEntries;
  try {
    bundledEntries = await fs.promises.readdir(bundledSkillsDir, { withFileTypes: true });
  } catch {
    return;
  }

  const skillNames = bundledEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (skillNames.length === 0) return;

  const currentSignature = skillNames.join(',');
  const sentinelPath = path.join(skillsDir, BUNDLED_SKILLS_SENTINEL);
  let previousOwned = new Set();
  try {
    const stored = JSON.parse(await fs.promises.readFile(sentinelPath, 'utf8'));
    if (stored.signature === currentSignature) return;
    if (Array.isArray(stored.owned)) previousOwned = new Set(stored.owned);
  } catch {
    // sentinel missing or malformed — proceed with sync
  }

  const owned = [];
  for (const name of skillNames) {
    const srcPath = path.join(bundledSkillsDir, name, 'SKILL.md');
    const destDir = path.join(skillsDir, name);
    const destPath = path.join(destDir, 'SKILL.md');

    let destExists = false;
    try {
      await fs.promises.access(destPath);
      destExists = true;
    } catch {
      /* absent — safe to write */
    }
    if (destExists && !previousOwned.has(name)) continue;

    try {
      const raw = await fs.promises.readFile(srcPath, 'utf8');
      const converted = convertToClaudeSkillFormat(raw);
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.writeFile(destPath, converted, 'utf8');
      owned.push(name);
    } catch {
      // ignore invalid entries
    }
  }

  try {
    await fs.promises.mkdir(skillsDir, { recursive: true });
    const sentinel = { signature: currentSignature, owned: owned.sort() };
    await fs.promises.writeFile(sentinelPath, JSON.stringify(sentinel), 'utf8');
  } catch {
    // non-fatal
  }
}

async function buildTmpBundledDir(skills) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-bundled-'));
  for (const { name: skillName, content } of skills) {
    const skillDir = path.join(tmpDir, skillName);
    await fs.promises.mkdir(skillDir);
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  }
  return tmpDir;
}

test('ensureBundledClaudeSkills: no-op when bundledSkillsDir does not exist', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  try {
    await ensureBundledClaudeSkillsInlined(userHome, '/nonexistent/bundled');
    // skills dir should not be created
    assert.ok(!fs.existsSync(path.join(userHome, '.claude', 'skills')));
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: no-op when bundled dir has no skill subdirectories', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  const bundledDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-bundled-'));
  // add a file (not a dir) to bundled dir
  await fs.promises.writeFile(path.join(bundledDir, 'README.md'), 'readme');
  try {
    await ensureBundledClaudeSkillsInlined(userHome, bundledDir);
    assert.ok(!fs.existsSync(path.join(userHome, '.claude', 'skills')));
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
    await fs.promises.rm(bundledDir, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: writes skills and sentinel on first run', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  const bundledDir = await buildTmpBundledDir([
    { name: 'git', content: `---\nname: git\ndescription: Git skill\n---\nbody\n` },
  ]);
  try {
    await ensureBundledClaudeSkillsInlined(userHome, bundledDir);
    const destPath = path.join(userHome, '.claude', 'skills', 'git', 'SKILL.md');
    assert.ok(fs.existsSync(destPath));
    const content = await fs.promises.readFile(destPath, 'utf8');
    assert.ok(content.includes('name: git'));
    // sentinel written
    const sentinelPath = path.join(userHome, '.claude', 'skills', BUNDLED_SKILLS_SENTINEL);
    const sentinel = JSON.parse(await fs.promises.readFile(sentinelPath, 'utf8'));
    assert.equal(sentinel.signature, 'git');
    assert.deepEqual(sentinel.owned, ['git']);
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
    await fs.promises.rm(bundledDir, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: skips sync when signature matches sentinel', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  const bundledDir = await buildTmpBundledDir([
    { name: 'git', content: `---\nname: git\ndescription: Git skill\n---\nbody\n` },
  ]);
  const skillsDir = path.join(userHome, '.claude', 'skills');
  await fs.promises.mkdir(skillsDir, { recursive: true });
  // pre-write sentinel with matching signature
  await fs.promises.writeFile(
    path.join(skillsDir, BUNDLED_SKILLS_SENTINEL),
    JSON.stringify({ signature: 'git', owned: ['git'] })
  );
  try {
    await ensureBundledClaudeSkillsInlined(userHome, bundledDir);
    // skill should NOT be written since signature matched
    assert.ok(!fs.existsSync(path.join(skillsDir, 'git', 'SKILL.md')));
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
    await fs.promises.rm(bundledDir, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: does not overwrite user-installed skill with same name', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  const bundledDir = await buildTmpBundledDir([
    { name: 'git', content: `---\nname: git\ndescription: AgentOS git\n---\narc body\n` },
  ]);
  const destDir = path.join(userHome, '.claude', 'skills', 'git');
  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.promises.writeFile(path.join(destDir, 'SKILL.md'), 'user content');
  // sentinel missing (no previous ownership of 'git')
  try {
    await ensureBundledClaudeSkillsInlined(userHome, bundledDir);
    const content = await fs.promises.readFile(path.join(destDir, 'SKILL.md'), 'utf8');
    assert.equal(content, 'user content'); // unchanged
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
    await fs.promises.rm(bundledDir, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: overwrites previously-owned skill on signature change', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  const bundledDir = await buildTmpBundledDir([
    { name: 'git', content: `---\nname: git\ndescription: AgentOS git v2\n---\nnew body\n` },
    { name: 'docker', content: `---\nname: docker\ndescription: Docker\n---\ndocker body\n` },
  ]);
  const skillsDir = path.join(userHome, '.claude', 'skills');
  await fs.promises.mkdir(path.join(skillsDir, 'git'), { recursive: true });
  await fs.promises.writeFile(path.join(skillsDir, 'git', 'SKILL.md'), 'old agentos content');
  // sentinel shows old signature with git owned, no docker yet
  await fs.promises.writeFile(
    path.join(skillsDir, BUNDLED_SKILLS_SENTINEL),
    JSON.stringify({ signature: 'git', owned: ['git'] })
  );
  try {
    await ensureBundledClaudeSkillsInlined(userHome, bundledDir);
    const gitContent = await fs.promises.readFile(path.join(skillsDir, 'git', 'SKILL.md'), 'utf8');
    assert.ok(gitContent.includes('name: git')); // overwritten
    assert.ok(fs.existsSync(path.join(skillsDir, 'docker', 'SKILL.md'))); // new skill added
    const sentinel = JSON.parse(await fs.promises.readFile(path.join(skillsDir, BUNDLED_SKILLS_SENTINEL), 'utf8'));
    assert.equal(sentinel.signature, 'docker,git');
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
    await fs.promises.rm(bundledDir, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: removes legacy plugin dir on startup', async () => {
  const userHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentos-home-'));
  const legacyDir = path.join(userHome, '.claude', 'plugins', 'agentos-bundled');
  await fs.promises.mkdir(legacyDir, { recursive: true });
  await fs.promises.writeFile(path.join(legacyDir, 'PLUGIN.md'), 'legacy content');
  const bundledDir = await buildTmpBundledDir([
    { name: 'git', content: `---\nname: git\ndescription: Git\n---\nbody\n` },
  ]);
  try {
    await ensureBundledClaudeSkillsInlined(userHome, bundledDir);
    assert.ok(!fs.existsSync(legacyDir));
  } finally {
    await fs.promises.rm(userHome, { recursive: true });
    await fs.promises.rm(bundledDir, { recursive: true });
  }
});

test('ensureBundledClaudeSkills: source anchoring — sentinel and collision guard logic in production source', () => {
  const sourcePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/main/utils/claudePlugins.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  // sentinel constant
  assert.ok(source.includes('.agentos-bundled-skills.json'), 'sentinel file name present');
  // collision guard: skip if dest exists and not previously owned
  assert.ok(source.includes('previousOwned.has(name)'), 'collision guard checks previousOwned');
  // legacy plugin migration
  assert.ok(source.includes('agentos-bundled'), 'legacy dir reference present');
});
