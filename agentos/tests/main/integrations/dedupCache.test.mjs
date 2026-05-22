/**
 * Tests for integrations/DedupCache.ts — bounded dedup set with FIFO eviction.
 * Class inlined — no TS loader needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from integrations/DedupCache.ts ───────────────────────────────────

class DedupCache {
  set = new Set();

  constructor(cap = 4000) {
    this.cap = cap;
  }

  has(key) {
    return this.set.has(key);
  }

  add(key) {
    this.set.add(key);
    if (this.set.size > this.cap) {
      const first = this.set.values().next().value;
      if (first !== undefined) this.set.delete(first);
    }
  }

  clear() {
    this.set.clear();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('has: returns false for unknown key', () => {
  const cache = new DedupCache();
  assert.equal(cache.has('x'), false);
});

test('has: returns true after add', () => {
  const cache = new DedupCache();
  cache.add('foo');
  assert.equal(cache.has('foo'), true);
});

test('add: multiple distinct keys are all retained', () => {
  const cache = new DedupCache();
  cache.add('a');
  cache.add('b');
  cache.add('c');
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
});

test('add: adding same key twice does not grow set', () => {
  const cache = new DedupCache(10);
  cache.add('dup');
  cache.add('dup');
  assert.equal(cache.has('dup'), true);
  assert.equal(cache.set.size, 1);
});

test('eviction: oldest key is removed when cap exceeded', () => {
  const cache = new DedupCache(3);
  cache.add('a');
  cache.add('b');
  cache.add('c');
  assert.equal(cache.has('a'), true);
  cache.add('d');
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);
});

test('eviction: FIFO order — each new add evicts oldest remaining', () => {
  const cache = new DedupCache(2);
  cache.add('first');
  cache.add('second');
  cache.add('third'); // evicts 'first'
  assert.equal(cache.has('first'), false);
  cache.add('fourth'); // evicts 'second'
  assert.equal(cache.has('second'), false);
  assert.equal(cache.has('third'), true);
  assert.equal(cache.has('fourth'), true);
});

test('clear: removes all keys', () => {
  const cache = new DedupCache();
  cache.add('a');
  cache.add('b');
  cache.clear();
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.set.size, 0);
});

test('clear: can add keys again after clear', () => {
  const cache = new DedupCache();
  cache.add('x');
  cache.clear();
  cache.add('x');
  assert.equal(cache.has('x'), true);
});

test('default cap is 4000', () => {
  const cache = new DedupCache();
  assert.equal(cache.cap, 4000);
});
