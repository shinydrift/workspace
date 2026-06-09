// Per-project serial Promise chain for background embedding work.
//
// Used by MemoryContentService.saveChunk to enqueue the embed + vec write so the
// caller can return chunk_id immediately while the (potentially slow) embedding
// HTTP/local-llama call resolves in the background. Concurrency is intentionally
// 1 per project — better-sqlite3 transactions on the same db must not interleave
// at random points in the JS turn.

const queues = new Map<string, Promise<void>>();

export function enqueueEmbed<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(projectId) ?? Promise.resolve();
  // Swallow previous rejections so a failed embed doesn't poison every later task.
  const safePrev = prev.catch((): void => undefined);
  const next = safePrev.then(task);
  const tail: Promise<void> = next.then(
    (): void => undefined,
    (): void => undefined
  );
  queues.set(projectId, tail);
  // Drop the Map entry once this tail is the latest one to resolve — otherwise
  // the Map grows by one entry per project that ever enqueued. Skip the delete
  // if a newer task has since chained on, since `queues.get(projectId)` will
  // point at that newer tail instead.
  void tail.then(() => {
    if (queues.get(projectId) === tail) queues.delete(projectId);
  });
  return next;
}

export async function flushPendingEmbeds(projectId?: string): Promise<void> {
  if (projectId) {
    await (queues.get(projectId) ?? Promise.resolve()).catch((): void => undefined);
    return;
  }
  await Promise.all([...queues.values()].map((p) => p.catch((): void => undefined)));
}
