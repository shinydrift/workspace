/**
 * Tests for utils/docker/sandbox.ts — buildDockerRunArgs and buildDockerExecArgs (inlined).
 * Pure functions — no Docker daemon, no Electron.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// ── Inlined from providerConfig.ts + types/settings.ts ────────────────────────

const PROVIDER_CONFIGS = {
  claude: {
    binaryName: 'claude',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.claude',
  },
  codex: {
    binaryName: 'codex',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.codex',
  },
  gemini: {
    binaryName: 'gemini',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    supportsHeadless: true,
    sessionConfigDir: '/home/agent/.gemini',
  },
};

const DEFAULT_SANDBOX_SETTINGS = {
  readOnlyRoot: false,
  dropAllCapabilities: true,
  noNewPrivileges: true,
  network: 'bridge',
  pidsLimit: 256,
  tmpfs: ['/tmp', '/var/tmp'],
};
const AGENTOS_MCP_BEARER_TOKEN_ENV_VAR = 'ARC_MCP_BEARER_TOKEN';

// ── Inlined from sandbox.ts ───────────────────────────────────────────────────

function validateBindMount(hostPath, containerPath) {
  if (!path.isAbsolute(hostPath)) throw new Error(`Bind mount host path must be absolute: ${hostPath}`);
  if (!path.isAbsolute(containerPath)) throw new Error(`Bind mount container path must be absolute: ${containerPath}`);
}

function buildDockerRunArgs(
  sessionId,
  workingDir,
  imageName,
  provider,
  apiKey,
  security = {},
  providerArgs = [],
  extraReadonlyMounts = [],
  labels = {},
  opts = {}
) {
  validateBindMount(workingDir, '/workspace');

  const cfg = PROVIDER_CONFIGS[provider];
  const sec = { ...DEFAULT_SANDBOX_SETTINGS, ...security };

  const args = [
    'run',
    '--rm',
    '-it',
    '--name',
    `agentos-session-${sessionId}`,
    '-v',
    `${workingDir}:/workspace`,
    '--workdir',
    '/workspace',
    ...(sec.readOnlyRoot ? ['--read-only'] : []),
    ...sec.tmpfs.flatMap((t) => ['--tmpfs', t]),
    ...(sec.dropAllCapabilities ? ['--cap-drop', 'ALL'] : []),
    ...(sec.noNewPrivileges ? ['--security-opt', 'no-new-privileges'] : []),
    ...(opts.seccompProfilePath ? ['--security-opt', `seccomp=${opts.seccompProfilePath}`] : []),
    '--network',
    sec.network,
    '--pids-limit',
    String(sec.pidsLimit),
    ...(sec.memory ? ['--memory', sec.memory, '--memory-swap', sec.memory] : []),
    ...(sec.cpus ? ['--cpus', sec.cpus] : []),
  ];

  for (const [key, value] of Object.entries(labels)) {
    if (!key || !value) continue;
    args.push('--label', `${key}=${value}`);
  }

  if (apiKey) {
    args.push('-e', `${cfg.apiKeyEnvVar}=${apiKey}`);
  }

  if (opts.claudeOauthToken) {
    args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${opts.claudeOauthToken}`);
  }

  if (opts.sessionDataDir) {
    validateBindMount(opts.sessionDataDir, cfg.sessionConfigDir);
    args.push('-v', `${opts.sessionDataDir}:${cfg.sessionConfigDir}`);
  }

  for (const mount of extraReadonlyMounts) {
    validateBindMount(mount.hostPath, mount.containerPath);
    const roSuffix = mount.readOnly !== false ? ':ro' : '';
    args.push('-v', `${mount.hostPath}:${mount.containerPath}${roSuffix}`);
  }

  if (opts.extraEnv) {
    for (const [key, value] of Object.entries(opts.extraEnv)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  if (opts.headless) {
    args.push(imageName, 'sleep', 'infinity');
  } else {
    args.push(imageName, cfg.binaryName, ...providerArgs);
  }

  return { command: 'docker', args };
}

function buildDockerExecArgs(threadId, input, opts) {
  const skipPermissions = opts.skipPermissions ?? true;

  if (opts.provider === 'codex') {
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${input}` : input;
    const commonFlags = [
      '--json',
      '--skip-git-repo-check',
      ...(skipPermissions ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
      ...(opts.memoryMcpUrl
        ? [
            '-c',
            `mcp_servers.agentos-memory.url="${opts.memoryMcpUrl}"`,
            '-c',
            `mcp_servers.agentos-memory.bearer_token_env_var="${AGENTOS_MCP_BEARER_TOKEN_ENV_VAR}"`,
          ]
        : []),
      ...(opts.threadMcpUrl
        ? [
            '-c',
            `mcp_servers.agentos-thread.url="${opts.threadMcpUrl}"`,
            '-c',
            `mcp_servers.agentos-thread.bearer_token_env_var="${AGENTOS_MCP_BEARER_TOKEN_ENV_VAR}"`,
          ]
        : []),
      ...(opts.slackMcpUrl
        ? [
            '-c',
            `mcp_servers.agentos-slack.url="${opts.slackMcpUrl}"`,
            '-c',
            `mcp_servers.agentos-slack.bearer_token_env_var="${AGENTOS_MCP_BEARER_TOKEN_ENV_VAR}"`,
          ]
        : []),
    ];
    const subcommand = opts.codexSessionId ? ['exec', 'resume', opts.codexSessionId, prompt] : ['exec', prompt];
    return {
      command: 'docker',
      args: ['exec', '-it', `agentos-session-${threadId}`, 'codex', ...subcommand, ...commonFlags],
    };
  }

  if (opts.provider === 'gemini') {
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${input}` : input;
    const args = [
      'exec',
      '-it',
      `agentos-session-${threadId}`,
      'gemini',
      '--prompt',
      prompt,
      '--output-format',
      'stream-json',
      '--yolo',
      ...(opts.geminiSessionId ? ['--resume', opts.geminiSessionId] : []),
      ...(opts.memoryMcpUrl ? ['--allowed-mcp-server-names', 'agentos-memory'] : []),
      ...(opts.threadMcpUrl ? ['--allowed-mcp-server-names', 'agentos-thread'] : []),
      ...(opts.slackMcpUrl ? ['--allowed-mcp-server-names', 'agentos-slack'] : []),
    ];
    return { command: 'docker', args };
  }

  // claude
  const args = [
    'exec',
    '-it',
    `agentos-session-${threadId}`,
    'claude',
    '-p',
    input,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
  ];

  if (opts.claudeSessionId) {
    args.push('--resume', opts.claudeSessionId);
  }

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  const mcpServers = {};
  if (opts.memoryMcpUrl) mcpServers['agentos-memory'] = { type: 'http', url: opts.memoryMcpUrl };
  if (opts.threadMcpUrl) mcpServers['agentos-thread'] = { type: 'http', url: opts.threadMcpUrl };
  if (opts.slackMcpUrl) mcpServers['agentos-slack'] = { type: 'http', url: opts.slackMcpUrl };
  if (Object.keys(mcpServers).length > 0) {
    args.push('--mcp-config', JSON.stringify({ mcpServers }));
  }

  return { command: 'docker', args };
}

// ── buildDockerRunArgs ────────────────────────────────────────────────────────

test('buildDockerRunArgs: command is docker', () => {
  const { command } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  assert.equal(command, 'docker');
});

test('buildDockerRunArgs: includes run --rm -it with session name', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  assert.ok(args.includes('run'));
  assert.ok(args.includes('--rm'));
  assert.ok(args.includes('-it'));
  assert.ok(args.includes('agentos-session-t1'));
});

test('buildDockerRunArgs: mounts workingDir to /workspace', () => {
  const { args } = buildDockerRunArgs('t1', '/home/user/project', 'agentos-sandbox:latest', 'claude');
  assert.ok(args.includes('/home/user/project:/workspace'));
});

test('buildDockerRunArgs: default security settings applied', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  assert.ok(args.includes('--cap-drop'));
  assert.ok(args.includes('ALL'));
  assert.ok(args.includes('--security-opt'));
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(args.includes('--network'));
  assert.ok(args.includes('bridge'));
  assert.ok(args.includes('--pids-limit'));
  assert.ok(args.includes('256'));
});

test('buildDockerRunArgs: seccomp profile path added when provided', () => {
  const { args } = buildDockerRunArgs(
    't1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], {},
    { seccompProfilePath: '/path/to/seccomp-sandbox.json' }
  );
  assert.ok(args.includes('--security-opt'));
  assert.ok(args.includes('seccomp=/path/to/seccomp-sandbox.json'));
});

test('buildDockerRunArgs: no seccomp flag when seccompProfilePath not provided', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  assert.ok(!args.some((a) => a.startsWith('seccomp=')));
});

test('buildDockerRunArgs: default tmpfs mounts', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  const tmpfsIdx = args.indexOf('--tmpfs');
  assert.ok(tmpfsIdx >= 0);
  assert.ok(args.includes('/tmp'));
  assert.ok(args.includes('/var/tmp'));
});

test('buildDockerRunArgs: readOnlyRoot adds --read-only', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {
    readOnlyRoot: true,
  });
  assert.ok(args.includes('--read-only'));
});

test('buildDockerRunArgs: no --read-only by default', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  assert.ok(!args.includes('--read-only'));
});

test('buildDockerRunArgs: api key passed as env var for claude', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', 'sk-test-key');
  const envIdx = args.indexOf('-e');
  assert.ok(envIdx >= 0);
  assert.ok(args.includes('ANTHROPIC_API_KEY=sk-test-key'));
});

test('buildDockerRunArgs: api key passed as env var for codex', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'codex', 'sk-openai-key');
  assert.ok(args.includes('OPENAI_API_KEY=sk-openai-key'));
});

test('buildDockerRunArgs: api key passed as env var for gemini', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'gemini', 'google-key');
  assert.ok(args.includes('GOOGLE_API_KEY=google-key'));
});

test('buildDockerRunArgs: no api key means no -e ANTHROPIC_API_KEY', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  assert.ok(!args.some((a) => a.startsWith('ANTHROPIC_API_KEY=')));
});

test('buildDockerRunArgs: oauth token added when provided', () => {
  const { args } = buildDockerRunArgs(
    't1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], {},
    { claudeOauthToken: 'oauth-tok' }
  );
  assert.ok(args.includes('CLAUDE_CODE_OAUTH_TOKEN=oauth-tok'));
});

test('buildDockerRunArgs: labels are added', () => {
  const labels = { 'agentos.managed': '1', 'agentos.threadId': 't1' };
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], labels);
  assert.ok(args.includes('--label'));
  assert.ok(args.includes('agentos.managed=1'));
  assert.ok(args.includes('agentos.threadId=t1'));
});

test('buildDockerRunArgs: empty label values are skipped', () => {
  const labels = { 'agentos.managed': '1', 'bad': '' };
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], labels);
  assert.ok(!args.includes('bad='));
});

test('buildDockerRunArgs: extra readonly mounts added with :ro suffix', () => {
  const mounts = [{ hostPath: '/agentos-memory', containerPath: '/agentos-memory' }];
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], mounts);
  assert.ok(args.includes('/agentos-memory:/agentos-memory:ro'));
});

test('buildDockerRunArgs: extra mount with readOnly=false has no :ro suffix', () => {
  const mounts = [{ hostPath: '/agentos-memory', containerPath: '/agentos-memory', readOnly: false }];
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], mounts);
  assert.ok(args.includes('/agentos-memory:/agentos-memory'));
  assert.ok(!args.includes('/agentos-memory:/agentos-memory:ro'));
});

test('buildDockerRunArgs: sessionDataDir mounts to provider sessionConfigDir', () => {
  const { args } = buildDockerRunArgs(
    't1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], {},
    { sessionDataDir: '/data/sessions/t1' }
  );
  assert.ok(args.includes('/data/sessions/t1:/home/agent/.claude'));
});

test('buildDockerRunArgs: extraEnv added as -e flags', () => {
  const { args } = buildDockerRunArgs(
    't1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], {},
    { extraEnv: { MY_VAR: 'value', ANOTHER: 'thing' } }
  );
  assert.ok(args.includes('MY_VAR=value'));
  assert.ok(args.includes('ANOTHER=thing'));
});

test('buildDockerRunArgs: headless=true runs sleep infinity', () => {
  const { args } = buildDockerRunArgs(
    't1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], [], {},
    { headless: true }
  );
  const imageIdx = args.indexOf('agentos-sandbox:latest');
  assert.ok(imageIdx >= 0);
  assert.equal(args[imageIdx + 1], 'sleep');
  assert.equal(args[imageIdx + 2], 'infinity');
});

test('buildDockerRunArgs: non-headless runs provider binary', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude');
  const imageIdx = args.indexOf('agentos-sandbox:latest');
  assert.ok(imageIdx >= 0);
  assert.equal(args[imageIdx + 1], 'claude');
});

test('buildDockerRunArgs: providerArgs appended after binary', () => {
  const { args } = buildDockerRunArgs(
    't1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {},
    ['--dangerously-skip-permissions']
  );
  const imageIdx = args.indexOf('agentos-sandbox:latest');
  assert.equal(args[imageIdx + 2], '--dangerously-skip-permissions');
});

test('buildDockerRunArgs: memory limit added when set', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, { memory: '2g' });
  assert.ok(args.includes('--memory'));
  assert.ok(args.includes('2g'));
  assert.ok(args.includes('--memory-swap'));
});

test('buildDockerRunArgs: cpu limit added when set', () => {
  const { args } = buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, { cpus: '2.0' });
  assert.ok(args.includes('--cpus'));
  assert.ok(args.includes('2.0'));
});

test('buildDockerRunArgs: throws for relative workingDir', () => {
  assert.throws(
    () => buildDockerRunArgs('t1', 'relative/path', 'agentos-sandbox:latest', 'claude'),
    /absolute/
  );
});

test('buildDockerRunArgs: throws for relative extraReadonlyMount hostPath', () => {
  const mounts = [{ hostPath: 'relative/path', containerPath: '/agentos-memory' }];
  assert.throws(
    () => buildDockerRunArgs('t1', '/workspace', 'agentos-sandbox:latest', 'claude', undefined, {}, [], mounts),
    /absolute/
  );
});

// ── buildDockerExecArgs: claude ───────────────────────────────────────────────

test('buildDockerExecArgs claude: basic structure', () => {
  const { command, args } = buildDockerExecArgs('t1', 'do the thing', { provider: 'claude' });
  assert.equal(command, 'docker');
  assert.deepEqual(args.slice(0, 3), ['exec', '-it', 'agentos-session-t1']);
  assert.ok(args.includes('claude'));
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('do the thing'));
});

test('buildDockerExecArgs claude: includes stream-json and verbose flags', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'claude' });
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('--verbose'));
  assert.ok(args.includes('--include-partial-messages'));
});

test('buildDockerExecArgs claude: skip permissions by default', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'claude' });
  assert.ok(args.includes('--dangerously-skip-permissions'));
});

test('buildDockerExecArgs claude: skip permissions disabled', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'claude', skipPermissions: false });
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('buildDockerExecArgs claude: resume flag added when sessionId provided', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'claude', claudeSessionId: 'sess-abc' });
  const resumeIdx = args.indexOf('--resume');
  assert.ok(resumeIdx >= 0);
  assert.equal(args[resumeIdx + 1], 'sess-abc');
});

test('buildDockerExecArgs claude: system prompt appended', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'claude', systemPrompt: 'be helpful' });
  assert.ok(args.includes('--append-system-prompt'));
  assert.ok(args.includes('be helpful'));
});

test('buildDockerExecArgs claude: mcp config added when memoryMcpUrl set', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', {
    provider: 'claude',
    memoryMcpUrl: 'http://host.docker.internal:3459/mcp',
  });
  const mcpIdx = args.indexOf('--mcp-config');
  assert.ok(mcpIdx >= 0);
  const mcpConfig = JSON.parse(args[mcpIdx + 1]);
  assert.ok('agentos-memory' in mcpConfig.mcpServers);
  assert.equal(mcpConfig.mcpServers['agentos-memory'].url, 'http://host.docker.internal:3459/mcp');
});

test('buildDockerExecArgs claude: multiple mcp servers combined', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', {
    provider: 'claude',
    memoryMcpUrl: 'http://mem/mcp',
    threadMcpUrl: 'http://thread/mcp',
    slackMcpUrl: 'http://slack/mcp',
  });
  const mcpIdx = args.indexOf('--mcp-config');
  const mcpConfig = JSON.parse(args[mcpIdx + 1]);
  assert.ok('agentos-memory' in mcpConfig.mcpServers);
  assert.ok('agentos-thread' in mcpConfig.mcpServers);
  assert.ok('agentos-slack' in mcpConfig.mcpServers);
});

test('buildDockerExecArgs claude: no mcp-config when no mcp urls', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'claude' });
  assert.ok(!args.includes('--mcp-config'));
});

// ── buildDockerExecArgs: codex ────────────────────────────────────────────────

test('buildDockerExecArgs codex: runs codex exec with prompt', () => {
  const { args } = buildDockerExecArgs('t1', 'fix the bug', { provider: 'codex' });
  assert.ok(args.includes('codex'));
  assert.ok(args.includes('exec'));
  assert.ok(args.includes('fix the bug'));
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--skip-git-repo-check'));
});

test('buildDockerExecArgs codex: resume uses codex exec resume', () => {
  const { args } = buildDockerExecArgs('t1', 'continue', { provider: 'codex', codexSessionId: 'sess-xyz' });
  assert.ok(args.includes('resume'));
  assert.ok(args.includes('sess-xyz'));
});

test('buildDockerExecArgs codex: skip permissions by default', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'codex' });
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('buildDockerExecArgs codex: skip permissions disabled', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'codex', skipPermissions: false });
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('buildDockerExecArgs codex: memoryMcpUrl added as -c flag', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', {
    provider: 'codex',
    memoryMcpUrl: 'http://mem/mcp',
  });
  assert.ok(args.includes('-c'));
  assert.ok(args.some((a) => a.includes('agentos-memory') && a.includes('http://mem/mcp')));
  assert.ok(
    args.some((a) => a.includes('agentos-memory') && a.includes(`bearer_token_env_var="${AGENTOS_MCP_BEARER_TOKEN_ENV_VAR}"`))
  );
});

test('buildDockerExecArgs codex: systemPrompt prepended to input', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'codex', systemPrompt: 'be concise' });
  const promptArg = args.find((a) => a.includes('be concise') && a.includes('hello'));
  assert.ok(promptArg);
});

// ── buildDockerExecArgs: gemini ───────────────────────────────────────────────

test('buildDockerExecArgs gemini: runs gemini with --prompt', () => {
  const { args } = buildDockerExecArgs('t1', 'summarize this', { provider: 'gemini' });
  assert.ok(args.includes('gemini'));
  assert.ok(args.includes('--prompt'));
  assert.ok(args.includes('summarize this'));
  assert.ok(args.includes('--yolo'));
  assert.ok(args.includes('stream-json'));
});

test('buildDockerExecArgs gemini: resume adds --resume flag', () => {
  const { args } = buildDockerExecArgs('t1', 'continue', { provider: 'gemini', geminiSessionId: 'gemini-sess' });
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('gemini-sess'));
});

test('buildDockerExecArgs gemini: mcp server names added when urls provided', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', {
    provider: 'gemini',
    memoryMcpUrl: 'http://mem/mcp',
    threadMcpUrl: 'http://thread/mcp',
  });
  assert.ok(args.includes('--allowed-mcp-server-names'));
  assert.ok(args.includes('agentos-memory'));
  assert.ok(args.includes('agentos-thread'));
});

test('buildDockerExecArgs gemini: systemPrompt prepended to input', () => {
  const { args } = buildDockerExecArgs('t1', 'hello', { provider: 'gemini', systemPrompt: 'be brief' });
  const promptArg = args.find((a) => a.includes('be brief') && a.includes('hello'));
  assert.ok(promptArg);
});
