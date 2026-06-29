import type { Medium } from '../../shared/types';

/**
 * Where an echo lands within a medium. `threadTs` is the reply anchor; when absent the post is
 * top-level (channel-scoped binding — e.g. automation summaries that have no thread to reply to).
 */
export interface EchoTarget {
  channelId: string;
  threadTs?: string;
}

/**
 * Outbound seam for mirroring a thread's posts to an external messaging medium. The Thread view is
 * the source of truth; each registered poster is a best-effort echo. Slack is the only implementation
 * today — wiring a new medium means adding a `MediumPoster` and registering it, with no changes to the
 * thread-posting call sites (they dispatch by `binding.medium`).
 */
export interface MediumPoster {
  readonly medium: Medium;
  /** Echo a text post. Top-level when `target.threadTs` is absent. */
  post(target: EchoTarget, text: string): void;
  /** Echo a file upload. Top-level when `target.threadTs` is absent. */
  upload(target: EchoTarget, hostPath: string, filename: string, comment?: string): Promise<void>;
}

const registry = new Map<Medium, MediumPoster>();

export function registerMediumPoster(poster: MediumPoster): void {
  registry.set(poster.medium, poster);
}

export function getMediumPoster(medium: Medium): MediumPoster | undefined {
  return registry.get(medium);
}
