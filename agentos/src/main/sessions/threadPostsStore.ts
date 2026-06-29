import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import type { ThreadPost, ThreadPostKind, ThreadPostAuthor, ThreadPostAttachment } from '../../shared/types';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { broadcastThreadPostAppended } from './broadcaster';

/**
 * Persists the Slack-style thread view conversation (prompts + agent updates/clarifications/files)
 * as one JSONL file per thread. Deliberately separate from the message store so the thread view is
 * decoupled from the raw chat transcript and from Slack.
 */
class ThreadPostsStore {
  private dir = '';

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
    fs.unlink(path.join(this.dir, `${threadId}.jsonl`), () => {});
  }
}

export const threadPostsStore = new ThreadPostsStore();
