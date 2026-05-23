import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import * as councilDb from './db';
import * as councilConfigDb from './councilDb';
import type { CouncilConfig, CouncilMember, CouncilOutcomeRecord, CouncilRun } from '../../shared/types/council';
import { eventLogger } from '../utils/eventLog';

const MAX_COUNCIL_MS = 15 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['submitted', 'invalid', 'error', 'timeout']);

const memberSchema = z.object({
  // pi excluded: council members must submit outcomes via MCP, which is not yet wired for pi.
  provider: z.enum(['claude', 'claude-interactive', 'codex', 'gemini']),
  model: z.string().max(128),
  effort: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  reasoning: z.enum(['low', 'medium', 'high', 'extra-high']).optional(),
});

const upsertConfigSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(128),
  members: z.array(memberSchema).min(1).max(8),
});

const runCouncilSchema = z.object({
  configId: z.string().min(1),
  parentThreadId: z.string().min(1),
  prompt: z.string().min(1).max(50_000),
});

const PROVIDER_LABEL = {
  claude: 'Claude',
  'claude-interactive': 'Claude (interactive)',
  codex: 'Codex',
  gemini: 'Gemini',
  pi: 'Pi',
} satisfies Record<CouncilMember['provider'], string>;

function memberLabel(m: CouncilMember): string {
  return `${PROVIDER_LABEL[m.provider]}/${m.model || 'default'}`;
}

/**
 * Thin abstraction over the thread system the council depends on. The real
 * implementation lives in `ThreadManager` and is injected via `setThreadRunner`
 * during app startup. Tests inject a fake. Keeping this interface narrow lets
 * the council service be developed and tested in isolation from PtyProcess /
 * docker exec wiring.
 *
 * Synthesis is NOT performed here — once children finish, the app appends a
 * synthesis message to the parent thread. The parent agent then calls
 * council_read_outcomes once and writes its synthesis as a normal assistant turn.
 */
export interface ThreadRunner {
  /** Spawn a council sub-thread inside the parent thread's container/worktree. */
  spawnChildThread(opts: {
    parentThreadId: string;
    runId: string;
    member: CouncilMember;
    memberLabel: string;
    prompt: string;
    onOutcome: (outcome: CouncilOutcomeRecord) => void;
  }): Promise<{ childThreadId: string }>;
}

let threadRunner: ThreadRunner | null = null;
export function setThreadRunner(runner: ThreadRunner): void {
  threadRunner = runner;
}

export const councilEvents = new EventEmitter();
councilEvents.setMaxListeners(100); // council_await_completion adds one listener per concurrent call

class CouncilService {
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Config CRUD (SQLite backed) ────────────────────────────────────────────

  listConfigs(): CouncilConfig[] {
    return councilConfigDb.listConfigs();
  }

  getConfig(id: string): CouncilConfig | null {
    return councilConfigDb.getConfig(id);
  }

  upsertConfig(input: Omit<CouncilConfig, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): CouncilConfig {
    const parsed = upsertConfigSchema.parse(input);
    const now = Date.now();
    const id = parsed.id ?? `council_${nanoid(8)}`;
    const existing = councilConfigDb.getConfig(id);
    const config: CouncilConfig = {
      id,
      name: parsed.name,
      members: parsed.members as CouncilMember[],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    councilConfigDb.upsertConfig(config);
    return config;
  }

  deleteConfig(id: string): void {
    if (councilDb.hasActiveRunForConfig(id)) {
      throw new Error(`Cannot delete council config ${id}: active runs exist`);
    }
    councilConfigDb.deleteConfig(id);
  }

  // ── Runs (SQLite backed) ────────────────────────────────────────────────────

  getRun(runId: string): CouncilRun | null {
    return councilDb.getRun(runId);
  }

  getOutcomes(runId: string): CouncilOutcomeRecord[] {
    return councilDb.getOutcomes(runId);
  }

  getRunsByThread(
    parentThreadId: string
  ): { run: CouncilRun; outcomes: CouncilOutcomeRecord[]; memberCount: number }[] {
    const all = councilDb.getRunsByThread(parentThreadId); // newest-first
    const active = all.filter((r) => r.status === 'running' || r.status === 'pending');
    const lastDone = all.find((r) => r.status !== 'running' && r.status !== 'pending');
    const visible = lastDone ? [...active, lastDone] : active;
    return visible.map((run) => ({
      run,
      outcomes: councilDb.getOutcomes(run.id),
      // Use council_run_members row count — immutable after dispatch and independent of config state.
      // Falls back to config for runs predating the per-member table.
      memberCount: councilDb.getRunMembers(run.id).length || (this.getConfig(run.configId)?.members.length ?? 0),
    }));
  }

  hasPendingRunForThread(parentThreadId: string): boolean {
    return councilDb.hasActiveRunForThread(parentThreadId);
  }

  /**
   * Returns true once every member of the run has either submitted an
   * outcome or errored. Derived from `council_run_members` rows so it is
   * independent of config mutations or deletions after dispatch.
   * Falls back to `status === 'done'` for runs created before the
   * per-member table existed.
   */
  isRunComplete(runId: string): boolean {
    const run = councilDb.getRun(runId);
    if (!run) return false;
    if (run.status === 'done') return true;
    return councilDb.allRunMembersTerminal(runId);
  }

  /**
   * Dispatch a council run against a parent thread.
   *
   * Spawns one child sub-thread per member sharing the parent's container
   * and returns the run record immediately. Children record outcomes via
   * `recordOutcome` as they finish; the parent agent polls
   * `council_read_outcomes` until `complete` is true and then writes its own
   * synthesis as a normal assistant turn.
   */
  async runCouncil(rawInput: { configId: string; parentThreadId: string; prompt: string }): Promise<CouncilRun> {
    const input = runCouncilSchema.parse(rawInput);
    if (!threadRunner) throw new Error('Council ThreadRunner not initialized');
    const config = this.getConfig(input.configId);
    if (!config) throw new Error(`Council config ${input.configId} not found`);
    if (config.members.length === 0) throw new Error('Council config must have at least one member');

    const now = Date.now();
    const runId = `crun_${nanoid(10)}`;
    const run: CouncilRun = {
      id: runId,
      configId: config.id,
      parentThreadId: input.parentThreadId,
      prompt: input.prompt,
      childThreadIds: [],
      status: 'running',
      createdAt: now,
      expiresAt: now + MAX_COUNCIL_MS,
    };
    councilDb.saveRun(run);

    // Register all expected members before spawning so completion is always
    // derivable from council_run_members rows rather than outcome count.
    config.members.forEach((member, idx) => {
      councilDb.insertRunMember(runId, idx, member);
    });

    councilEvents.emit('run:updated', run);

    eventLogger.info('council', 'Council run dispatched', {
      runId,
      configId: config.id,
      parentThreadId: input.parentThreadId,
      memberCount: config.members.length,
      members: config.members.map(memberLabel),
    });

    // Async IIFE per member captures sync throws from spawnChildThread (L3).
    // On resolve: record the real child ID and transition to running.
    // On reject (pre-spawn or post-spawn failure): insert a synthetic error
    // outcome so synthesizers always see a complete set of member records.
    config.members.forEach((member, idx) => {
      const label = memberLabel(member);
      (async () => {
        const { childThreadId } = await threadRunner!.spawnChildThread({
          parentThreadId: input.parentThreadId,
          runId,
          member,
          memberLabel: label,
          prompt: input.prompt,
          onOutcome: (outcome) => this.recordOutcome(runId, outcome),
        });
        eventLogger.debug('council', 'Council child thread spawned', { runId, childThreadId, member: label });
        councilDb.updateRunMember(runId, idx, { childThreadId, status: 'running' });
      })().catch((err: unknown) => {
        const error = (err as Error).message;
        eventLogger.error('council', 'Council child thread spawn failed', { runId, member: label, error });
        // Register a synthetic childThreadId so recordOutcome's identity check
        // can look up the member and the UI gets a visible error record.
        const syntheticChildId = `spawn_error_${runId}_${idx}`;
        councilDb.updateRunMember(runId, idx, { childThreadId: syntheticChildId, status: 'error' });
        councilEvents.emit('run:member-error', { runId, memberIdx: idx, error });
        this.recordOutcome(runId, {
          runId,
          childThreadId: syntheticChildId,
          member,
          status: 'error',
          error,
          submittedAt: Date.now(),
        });
      });
    });

    this.armWatchdog(runId, MAX_COUNCIL_MS);
    return run;
  }

  registerChildMember(runId: string, childThreadId: string, member: CouncilMember): void {
    councilDb.registerChildMember(runId, childThreadId, member);
  }

  getMemberForChild(runId: string, childThreadId: string): CouncilMember | null {
    return councilDb.getMemberForChild(runId, childThreadId);
  }

  getRunMembers(runId: string) {
    return councilDb.getRunMembers(runId);
  }

  /** Called by child sub-threads (via MCP tool or ThreadRunner.onOutcome). Public for tests. */
  recordOutcome(runId: string, outcome: CouncilOutcomeRecord): void {
    // Verify run exists before writing any data (L1).
    const run = councilDb.getRun(runId);
    if (!run) {
      eventLogger.warn('council', 'Council outcome for unknown run — ignored', {
        runId,
        childThreadId: outcome.childThreadId,
      });
      return;
    }

    // Re-derive member identity from the registered child row to prevent
    // callers from spoofing which provider submitted an outcome (H3).
    const registeredMember = councilDb.getMemberForChild(runId, outcome.childThreadId);
    if (!registeredMember) {
      eventLogger.warn('council', 'Council outcome from unregistered child — ignored', {
        runId,
        childThreadId: outcome.childThreadId,
      });
      return;
    }
    const sanitized: CouncilOutcomeRecord = { ...outcome, member: registeredMember };

    const inserted = councilDb.saveOutcome(sanitized);
    if (!inserted) {
      eventLogger.warn('council', 'Council outcome duplicate — ignored', {
        runId,
        childThreadId: sanitized.childThreadId,
        status: sanitized.status,
        member: memberLabel(sanitized.member),
      });
      return; // already recorded — dedup
    }

    eventLogger.info('council', 'Council outcome recorded', {
      runId,
      childThreadId: sanitized.childThreadId,
      status: sanitized.status,
      ...(sanitized.error ? { error: sanitized.error } : {}),
    });

    // Advance the member row to the terminal status
    councilDb.updateRunMemberByChildId(runId, sanitized.childThreadId, sanitized.status);

    councilEvents.emit('outcome:submitted', { runId, outcome: sanitized });
    this.maybeCompleteRun(runId);
  }

  /** Re-arm watchdog timers for any in-flight runs on startup. Call after setThreadRunner. */
  rearmTimers(): void {
    const active = councilDb.getActiveRuns();
    const now = Date.now();
    for (const run of active) {
      const expiresAt = run.expiresAt ?? run.createdAt + MAX_COUNCIL_MS;
      const remaining = Math.max(expiresAt - now, 0);
      this.armWatchdog(run.id, remaining);
    }
  }

  private armWatchdog(runId: string, ms: number): void {
    const timer = setTimeout(() => this.expireRun(runId), ms);
    this._timers.set(runId, timer);
  }

  private clearWatchdog(runId: string): void {
    const timer = this._timers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(runId);
    }
  }

  private expireRun(runId: string): void {
    this._timers.delete(runId); // already fired — don't let clearWatchdog try to cancel it
    const members = councilDb.getRunMembers(runId);
    for (const m of members) {
      if (TERMINAL_STATUSES.has(m.status)) continue;
      // If spawn never completed, assign a synthetic childThreadId so the
      // outcome can be looked up by getMemberForChild.
      const childId = m.childThreadId ?? `timeout_${runId}_${m.memberIdx}`;
      if (!m.childThreadId) {
        councilDb.updateRunMember(runId, m.memberIdx, { childThreadId: childId, status: 'timeout' });
      } else {
        councilDb.updateRunMember(runId, m.memberIdx, { status: 'timeout' });
      }
      this.recordOutcome(runId, {
        runId,
        childThreadId: childId,
        member: { provider: m.provider as CouncilMember['provider'], model: m.model },
        status: 'timeout',
        error: 'Council run exceeded maximum duration',
        submittedAt: Date.now(),
      });
    }
  }

  private maybeCompleteRun(runId: string): void {
    const completed = councilDb.markRunDoneIfTerminal(runId, Date.now());
    if (completed) {
      const updatedRun = councilDb.getRun(runId);
      if (updatedRun) {
        eventLogger.info('council', 'Council run complete', { runId });
        councilEvents.emit('run:updated', updatedRun);
        this.clearWatchdog(runId);
      }
    }
  }
}

export const councilService = new CouncilService();
