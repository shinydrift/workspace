import type { ThreadRunner } from './service';
import type { CouncilMember, CouncilOutcomeRecord } from '../../shared/types/council';

/**
 * Real ThreadRunner backed by ThreadManager.spawnCouncilChildThread.
 *
 * Synthesis is intentionally NOT a method here: once children submit outcomes,
 * the app appends a synthesis message to the parent thread. The parent agent
 * then calls council_read_outcomes once and writes its synthesis.
 */
export interface CouncilThreadRunnerDeps {
  spawnChildThread(opts: {
    parentThreadId: string;
    runId: string;
    member: CouncilMember;
    memberLabel: string;
    prompt: string;
    onOutcome: (outcome: CouncilOutcomeRecord) => void;
  }): Promise<{ childThreadId: string }>;
}

export function createCouncilThreadRunner(deps: CouncilThreadRunnerDeps): ThreadRunner {
  return {
    spawnChildThread: (opts) => deps.spawnChildThread(opts),
  };
}
