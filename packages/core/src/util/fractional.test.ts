import { describe, expect, it } from 'vitest';
import { keyAfterAll, keyBetween } from './fractional.js';

describe('keyBetween', () => {
  it('generates a key with no bounds', () => {
    expect(keyBetween(null, null)).toBe('i');
  });

  it('generates ordered keys forward and backward', () => {
    let prev = keyBetween(null, null);
    for (let i = 0; i < 100; i++) {
      const next = keyBetween(prev, null);
      expect(next > prev).toBe(true);
      prev = next;
    }
    let after = keyBetween(null, null);
    for (let i = 0; i < 100; i++) {
      const before = keyBetween(null, after);
      expect(before < after).toBe(true);
      after = before;
    }
  });

  it('bisects repeatedly without collision', () => {
    let lo = keyBetween(null, null);
    let hi = keyBetween(lo, null);
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(lo, hi);
      expect(mid > lo && mid < hi).toBe(true);
      if (i % 2 === 0) lo = mid;
      else hi = mid;
    }
  });

  it('never produces trailing zeros', () => {
    let lo: string | null = null;
    let key = keyBetween(null, null);
    for (let i = 0; i < 50; i++) {
      expect(key.endsWith('0')).toBe(false);
      lo = key;
      key = keyBetween(lo, keyBetween(lo, null));
    }
  });

  it('rejects out-of-order bounds', () => {
    expect(() => keyBetween('b', 'a')).toThrow();
    expect(() => keyBetween('a', 'a')).toThrow();
  });

  it('keyAfterAll returns key after the max', () => {
    const keys = ['a', 'c', 'b'];
    const after = keyAfterAll(keys);
    for (const k of keys) expect(after > k).toBe(true);
    expect(keyAfterAll([])).toBe('i');
  });
});
