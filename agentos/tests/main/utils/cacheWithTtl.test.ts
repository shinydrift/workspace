/**
 * Tests for src/main/utils/CacheWithTtl.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheWithTtl } from '../../../src/main/utils/CacheWithTtl';

test('returns computed value on first call', () => {
  const cache = new CacheWithTtl<string, number>(10_000);
  const result = cache.get('k', () => 42);
  assert.strictEqual(result, 42);
});

test('returns cached value without calling compute again within TTL', () => {
  const cache = new CacheWithTtl<string, number>(10_000);
  let calls = 0;
  cache.get('k', () => (calls++, 1));
  cache.get('k', () => (calls++, 2));
  assert.strictEqual(calls, 1);
});

test('returns value from cache hit, not second compute', () => {
  const cache = new CacheWithTtl<string, number>(10_000);
  cache.get('k', () => 7);
  const result = cache.get('k', () => 99);
  assert.strictEqual(result, 7);
});

test('recomputes when TTL is expired (negative TTL is always expired)', () => {
  const cache = new CacheWithTtl<string, number>(-1);
  let calls = 0;
  cache.get('k', () => (calls++, 1));
  cache.get('k', () => (calls++, 2));
  assert.strictEqual(calls, 2);
});

test('independent keys do not interfere', () => {
  const cache = new CacheWithTtl<string, string>(10_000);
  const a = cache.get('a', () => 'alpha');
  const b = cache.get('b', () => 'beta');
  assert.strictEqual(a, 'alpha');
  assert.strictEqual(b, 'beta');
});

test('has() returns true for a cached key within TTL', () => {
  const cache = new CacheWithTtl<string, number>(10_000);
  cache.get('k', () => 1);
  assert.ok(cache.has('k'));
});

test('has() returns false for an unknown key', () => {
  const cache = new CacheWithTtl<string, number>(10_000);
  assert.strictEqual(cache.has('missing'), false);
});

test('has() returns false when TTL is expired', () => {
  const cache = new CacheWithTtl<string, number>(-1);
  cache.get('k', () => 1);
  assert.strictEqual(cache.has('k'), false);
});

test('compute may return any value type', () => {
  const cache = new CacheWithTtl<string, { x: number }>(10_000);
  const obj = { x: 5 };
  const result = cache.get('k', () => obj);
  assert.strictEqual(result, obj);
});
