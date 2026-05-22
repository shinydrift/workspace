// Bounded-size dedup set with FIFO eviction.
// Used by message bridges to ignore duplicate inbound events.
export class DedupCache {
  private readonly set = new Set<string>();

  constructor(private readonly cap = 4000) {}

  has(key: string): boolean {
    return this.set.has(key);
  }

  add(key: string): void {
    this.set.add(key);
    if (this.set.size > this.cap) {
      const first = this.set.values().next().value;
      if (first !== undefined) this.set.delete(first);
    }
  }

  delete(key: string): boolean {
    return this.set.delete(key);
  }

  clear(): void {
    this.set.clear();
  }
}
