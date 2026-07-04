import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import type {
  ThreadPost,
  ThreadPostKind,
  ThreadPostAuthor,
  ThreadPostAttachment,
  ThreadPostTerminalStatus,
  ThreadStatusEvent,
} from '../../shared/types';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { broadcastThreadPostAppended, broadcastThreadPostUpdated } from './broadcaster';
import { deriveThreadPostStatus } from './threadPostStatus';

/**
 * Persists the Slack-style thread view conversation (prompts + agent updates/clarifications/files)
 * as one JSONL file per thread. Deliberately separate from the message store so the thread view is
 * decoupled from the raw chat transcript and from Slack.
 */
class ThreadPostsStore {
  private dir = '';
  /** The prompt post a thread's current turn is processing — the target for the terminal status. */
  private currentPromptId = new Map<string, string>();

  setDir(dir: string): void {
    this.dir = dir;
  }

  append(
    threadId: string,
    kind: ThreadPostKind,
    author: ThreadPostAuthor,
    text: string,
    attachment?: ThreadPostAttachment
  ): ThreadPost {
    const post: ThreadPost = {
      id: nanoid(),
      threadId,
      kind,
      author,
      text,
      ...(attachment ? { attachment } : {}),
      createdAt: Date.now(),
    };
    // A prompt starts a new turn; subsequent status events resolve onto it.
    if (kind === 'prompt') this.currentPromptId.set(threadId, post.id);
    broadcastThreadPostAppended({ threadId, post });
    try {
      fs.appendFileSync(path.join(this.dir, `${threadId}.jsonl`), JSON.stringify(post) + '\n');
    } catch (err) {
      eventLogger.error('thread', 'Failed to persist thread post', { threadId, kind, error: getErrorMessage(err) });
    }
    return post;
  }

  list(threadId: string): ThreadPost[] {
    const p = path.join(this.dir, `${threadId}.jsonl`);
    if (!fs.existsSync(p)) return [];
    try {
      return fs
        .readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ThreadPost);
    } catch {
      return [];
    }
  }

  clear(threadId: string): void {
    this.currentPromptId.delete(threadId);
    fs.unlink(path.join(this.dir, `${threadId}.jsonl`), () => {});
  }

  /**
   * Persists the terminal outcome (✅ done / ❌ error) onto the thread's current prompt post when its
   * turn resolves. Once written, the prompt is cleared as the current target so a later idle/running
   * event can't overwrite the outcome. The transient working/autopilot/council badge is derived live
   * in the renderer, so it is intentionally not persisted here.
   */
  applyThreadStatus(payload: ThreadStatusEvent): void {
    const postId = this.currentPromptId.get(payload.threadId);
    if (!postId) return;
    // A pending council keeps the turn unsettled (🏛️) — the parent idles right after dispatch, so
    // don't let that idle persist ✅ yet; the post-council broadcast resolves the outcome instead.
    if (payload.reaction === 'council') return;
    const status = deriveThreadPostStatus(payload);
    if (!status) return;
    this.currentPromptId.delete(payload.threadId);
    this.setStatus(payload.threadId, postId, status);
  }

  private setStatus(threadId: string, postId: string, status: ThreadPostTerminalStatus): void {
    const p = path.join(this.dir, `${threadId}.jsonl`);
    if (!fs.existsSync(p)) return;
    try {
      const posts = fs
        .readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ThreadPost);
      const target = posts.find((post) => post.id === postId);
      if (!target || target.status === status) return;
      target.status = status;
      fs.writeFileSync(p, posts.map((post) => JSON.stringify(post)).join('\n') + '\n');
      broadcastThreadPostUpdated({ threadId, post: target });
    } catch (err) {
      eventLogger.error('thread', 'Failed to update thread post status', {
        threadId,
        postId,
        error: getErrorMessage(err),
      });
    }
  }
}

export const threadPostsStore = new ThreadPostsStore();
