/** Map-keyed TTL cache. For a single-value cache, use a constant key (e.g. `'_'`). */
export class CacheWithTtl<K extends string, V> {
  private readonly store = new Map<K, { data: V; expiry: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: K, compute: () => V): V {
    const hit = this.store.get(key);
    if (hit && Date.now() < hit.expiry) return hit.data;
    const data = compute();
    // Record expiry after compute completes so TTL isn't shortened by compute time
    this.store.set(key, { data, expiry: Date.now() + this.ttlMs });
    return data;
  }

  /** Returns true if a non-expired entry exists for key. Evicts the entry if expired. */
  has(key: K): boolean {
    const hit = this.store.get(key);
    if (!hit) return false;
    if (Date.now() < hit.expiry) return true;
    this.store.delete(key);
    return false;
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
