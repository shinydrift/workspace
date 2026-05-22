/**
 * Smoke test for the council end-to-end protocol.
 *
 * Per repo convention, logic is inlined: this test mirrors the contracts of
 * - src/main/utils/docker/sandbox.ts (buildDockerExecArgs)
 * - src/main/council/bootInstructions.ts (buildCouncilBootInstructions)
 * - src/main/council/councilOutcomeParser.ts (parseCouncilOutcome)
 * - src/shared/types/council.ts (sentinels)
 *
 * Verifies shape only; does not spawn docker or hit the network.
 */
import assert from 'node:assert/strict';

const COUNCIL_OUTCOME_BEGIN = '<<<COUNCIL_OUTCOME>>>';
const COUNCIL_OUTCOME_END = '<<<END_COUNCIL_OUTCOME>>>';

// ── Inlined: buildCouncilBootInstructions ────────────────────────────────────
function buildCouncilBootInstructions({ runId, memberLabel }) {
  return [
    `You are participating in a council run (id=${runId}) as member "${memberLabel}".`,
    '',
    'Rules:',
    '- You share a working directory with other council members. DO NOT modify any files.',
    '- You may read files, but treat the workspace as read-only for this run.',
    '- Answer the user prompt that follows in your own reasoning style.',
    '- When you are finished, emit EXACTLY ONE final block in this format and then stop:',
    '',
    COUNCIL_OUTCOME_BEGIN,
    '{ "summary": "...", "answer": "...", "confidence": <0..1>, "caveats": ["..."] }',
    COUNCIL_OUTCOME_END,
  ].join('\n');
}

// ── Inlined: parseCouncilOutcome ─────────────────────────────────────────────
function parseCouncilOutcome(buffer) {
  const beginIdx = buffer.indexOf(COUNCIL_OUTCOME_BEGIN);
  if (beginIdx === -1) return { status: 'pending' };
  const afterBegin = beginIdx + COUNCIL_OUTCOME_BEGIN.length;
  const endIdx = buffer.indexOf(COUNCIL_OUTCOME_END, afterBegin);
  if (endIdx === -1) return { status: 'pending' };
  const inner = buffer.slice(afterBegin, endIdx).trim();
  if (!inner) return { status: 'invalid', error: 'empty outcome block' };
  let parsed;
  try {
    parsed = JSON.parse(inner);
  } catch (err) {
    return { status: 'invalid', error: err.message };
  }
  if (!parsed || typeof parsed !== 'object') return { status: 'invalid', error: 'not an object' };
  if (typeof parsed.summary !== 'string' || typeof parsed.answer !== 'string') {
    return { status: 'invalid', error: 'missing summary/answer' };
  }
  return {
    status: 'submitted',
    outcome: {
      summary: parsed.summary,
      answer: parsed.answer,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c) => typeof c === 'string') : undefined,
    },
  };
}

// ── Inlined: buildDockerExecArgs (mirrors sandbox.ts contract) ───────────────
function buildDockerExecArgs(threadId, input, opts) {
  const skipPermissions = opts.skipPermissions ?? true;
  const modelArgs = !opts.model
    ? []
    : opts.provider === 'codex'
      ? ['-m', opts.model]
      : ['--model', opts.model];

  if (opts.provider === 'codex') {
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${input}` : input;
    const flags = [
      '--json',
      '--skip-git-repo-check',
      ...(skipPermissions ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
      ...(opts.councilMcpUrl
        ? [
            '-c',
            `mcp_servers.agentos-council.url="${opts.councilMcpUrl}"`,
            '-c',
            `mcp_servers.agentos-council.bearer_token_env_var="AGENTOS_MCP_BEARER"`,
          ]
        : []),
    ];
    return {
      command: 'docker',
      args: [
        'exec',
        '-it',
        '--user',
        'agent',
        `agentos-session-${threadId}`,
        'codex',
        'exec',
        prompt,
        ...flags,
        ...modelArgs,
      ],
    };
  }

  if (opts.provider === 'gemini') {
    return {
      command: 'docker',
      args: [
        'exec',
        '-it',
        '--user',
        'agent',
        `agentos-session-${threadId}`,
        'gemini',
        '--prompt',
        input,
        '--output-format',
        'stream-json',
        '--yolo',
        ...modelArgs,
        ...(opts.councilMcpUrl ? ['--allowed-mcp-server-names', 'agentos-council'] : []),
      ],
    };
  }

  // claude
  const args = [
    'exec',
    '-it',
    '--user',
    'agent',
    `agentos-session-${threadId}`,
    'claude',
    '-p',
    input,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ...modelArgs,
  ];
  if (opts.councilMcpUrl) {
    const mcpServers = {
      'agentos-council': { type: 'http', url: opts.councilMcpUrl, headers: {} },
    };
    args.push('--mcp-config', JSON.stringify({ mcpServers }));
  }
  return { command: 'docker', args };
}

console.log('── council smoke test ──');

// ── 1. boot instructions embed sentinels + runId ─────────────────────────────
{
  const boot = buildCouncilBootInstructions({ runId: 'crun_smoke', memberLabel: 'Claude/opus' });
  assert.ok(boot.includes(COUNCIL_OUTCOME_BEGIN));
  assert.ok(boot.includes(COUNCIL_OUTCOME_END));
  assert.ok(boot.includes('crun_smoke'));
  assert.ok(boot.includes('Claude/opus'));
  console.log('✓ buildCouncilBootInstructions embeds sentinels + runId + label');
}

// ── 2. exec args per provider with model flag ────────────────────────────────
{
  const { command, args } = buildDockerExecArgs('thread_parent_abc', 'solve: 2+2', {
    provider: 'claude',
    model: 'opus',
    skipPermissions: true,
  });
  assert.equal(command, 'docker');
  assert.deepEqual(args.slice(0, 5), ['exec', '-it', '--user', 'agent', 'agentos-session-thread_parent_abc']);
  assert.equal(args[5], 'claude');
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
  assert.ok(args.includes('--dangerously-skip-permissions'));
  console.log('✓ claude exec args carry --model opus into parent container');
}

{
  const { args } = buildDockerExecArgs('thread_parent_abc', 'hi', { provider: 'codex', model: 'gpt-5' });
  assert.equal(args[5], 'codex');
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-5');
  console.log('✓ codex exec args carry -m gpt-5');
}

{
  const { args } = buildDockerExecArgs('thread_parent_abc', 'hi', {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
  });
  assert.equal(args[5], 'gemini');
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-2.0-flash');
  console.log('✓ gemini exec args carry --model gemini-2.0-flash');
}

// ── 3. council MCP URL propagates per-provider ───────────────────────────────
{
  const url = 'http://host.docker.internal:3461/mcp';
  const { args } = buildDockerExecArgs('t', 'hi', { provider: 'claude', councilMcpUrl: url });
  const cfg = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
  assert.equal(cfg.mcpServers['agentos-council'].url, url);
  console.log('✓ claude --mcp-config carries agentos-council entry');
}
{
  const { args } = buildDockerExecArgs('t', 'hi', { provider: 'codex', councilMcpUrl: 'http://x/mcp' });
  assert.ok(args.join(' ').includes('mcp_servers.agentos-council.url'));
  console.log('✓ codex -c mcp_servers.agentos-council.url present');
}
{
  const { args } = buildDockerExecArgs('t', 'hi', { provider: 'gemini', councilMcpUrl: 'http://x/mcp' });
  assert.ok(args.includes('agentos-council'));
  console.log('✓ gemini --allowed-mcp-server-names agentos-council present');
}

// ── 4. byte-by-byte streaming parser ─────────────────────────────────────────
{
  const chatter = 'Thinking...\nHere is my answer:\n\n';
  const payload = JSON.stringify({
    summary: 'Pick option A',
    answer: 'Option A because it is simpler',
    confidence: 0.8,
    caveats: ['assumes 2024 spec'],
  });
  const trailing = '\nok thats all.';
  const full = `${chatter}${COUNCIL_OUTCOME_BEGIN}\n${payload}\n${COUNCIL_OUTCOME_END}${trailing}`;
  let buffer = '';
  let fired = false;
  for (const ch of full) {
    buffer += ch;
    const r = parseCouncilOutcome(buffer);
    if (r.status === 'submitted') {
      fired = true;
      assert.equal(r.outcome.summary, 'Pick option A');
      assert.equal(r.outcome.confidence, 0.8);
      assert.deepEqual(r.outcome.caveats, ['assumes 2024 spec']);
      break;
    }
    if (r.status === 'invalid') throw new Error(`unexpected invalid: ${r.error}`);
  }
  assert.ok(fired);
  console.log('✓ parseCouncilOutcome handles byte-by-byte stream with chatter prefix');
}

// ── 5. malformed payload → invalid ───────────────────────────────────────────
{
  const bad = `${COUNCIL_OUTCOME_BEGIN}\n{"summary":"oops"}\n${COUNCIL_OUTCOME_END}`;
  const r = parseCouncilOutcome(bad);
  assert.equal(r.status, 'invalid');
  assert.match(r.error, /missing summary\/answer/);
  console.log('✓ malformed outcome surfaces as invalid with missing-fields error');
}

console.log('\n✅ council smoke test passed');
