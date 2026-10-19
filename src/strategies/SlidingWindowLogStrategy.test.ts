import { beforeEach, describe, expect, it } from 'vitest';

import type { RateLimitResult } from '@/domain';
import type { RateLimitStore, StateTransition } from '@/interfaces';
import { InMemoryStore } from '@/stores';
import { FakeClock } from '@/testing';

import { SlidingWindowLogStrategy, type SlidingWindowLog } from './SlidingWindowLogStrategy';

const POLICY = { limit: 10, windowMs: 1000 };

describe('SlidingWindowLogStrategy (10 requests per 1000 ms)', () => {
  let clock: FakeClock;
  let storedLengths: number[];
  let strategy: SlidingWindowLogStrategy;

  beforeEach(() => {
    clock = new FakeClock();
    storedLengths = [];
    strategy = new SlidingWindowLogStrategy(
      recording(new InMemoryStore<SlidingWindowLog>(clock), storedLengths),
      clock,
    );
  });

  const hit = (key = 'alice'): Promise<RateLimitResult> => strategy.consume(key, POLICY);

  const hitTimes = async (n: number, key = 'alice'): Promise<RateLimitResult[]> => {
    const results: RateLimitResult[] = [];
    for (let i = 0; i < n; i++) results.push(await hit(key));
    return results;
  };

  it('allows a burst of 10 and counts remaining down from 9 to 0', async () => {
    const results = await hitTimes(10);
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results.map((r) => r.remaining)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('denies the 11th request with the exact wait until the oldest request leaves the window', async () => {
    await hitTimes(10);
    clock.advance(300);
    expect(await hit()).toEqual({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetMs: 700,
      retryAfterMs: 700,
    });
  });

  it('allows again after exactly retryAfterMs, and still denies 1 ms before', async () => {
    await hitTimes(10);
    const denied = await hit();
    expect(denied.retryAfterMs).toBe(1000);

    clock.advance(denied.retryAfterMs - 1);
    expect(await hit()).toMatchObject({ allowed: false, retryAfterMs: 1 });
    clock.advance(1);
    expect(await hit()).toEqual({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetMs: 1000,
      retryAfterMs: 0,
    });
  });

  it('slides: requests free up as they age out, not all at once', async () => {
    await hitTimes(5); // t=0
    clock.set(500);
    await hitTimes(5); // t=500
    clock.set(999);
    expect(await hit()).toMatchObject({ allowed: false, retryAfterMs: 1 });

    clock.set(1000); // the five t=0 requests leave the window
    const results = await hitTimes(6);
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results[5]).toMatchObject({ retryAfterMs: 500 }); // next to leave: the t=500 batch
  });

  it('does not record denied requests, so hammering does not push the wait out', async () => {
    await hitTimes(10); // t=0
    clock.set(500);
    const denied = await hitTimes(50);
    expect(denied.every((r) => !r.allowed && r.retryAfterMs === 500)).toBe(true);

    clock.set(1000); // only the t=0 requests expire
    expect((await hitTimes(10)).every((r) => r.allowed)).toBe(true);
  });

  it('reports resetMs as the time until the oldest kept request leaves the window', async () => {
    expect(await hit()).toMatchObject({ allowed: true, remaining: 9, resetMs: 1000 });
    clock.advance(250);
    expect(await hit()).toMatchObject({ allowed: true, remaining: 8, resetMs: 750 });
  });

  it('tracks each key independently', async () => {
    await hitTimes(10, 'alice');
    expect((await hit('alice')).allowed).toBe(false);
    expect(await hit('bob')).toMatchObject({ allowed: true, remaining: 9 });
  });

  it('never stores more than limit timestamps per key', async () => {
    await hitTimes(10);
    clock.advance(500);
    await hitTimes(50);
    clock.advance(600);
    await hitTimes(20);

    expect(storedLengths).toHaveLength(80);
    expect(Math.max(...storedLengths)).toBe(10);
  });

  it('never allows more than limit requests in any windowMs span (seeded random arrivals)', async () => {
    const random = mulberry32(42);
    const allowedAt: number[] = [];
    for (let i = 0; i < 2000; i++) {
      clock.advance(Math.floor(random() * 60));
      if ((await hit()).allowed) allowedAt.push(clock.now());
    }

    expect(allowedAt.length).toBeGreaterThan(100);
    for (const [i, start] of allowedAt.entries()) {
      const inWindow = allowedAt.slice(i).filter((t) => t < start + POLICY.windowMs).length;
      expect(inWindow).toBeLessThanOrEqual(POLICY.limit);
    }
  });
});

/** Wraps a store and records the length of every log it writes. */
function recording(
  inner: RateLimitStore<SlidingWindowLog>,
  lengths: number[],
): RateLimitStore<SlidingWindowLog> {
  return {
    update<TResult>(
      key: string,
      ttlMs: number,
      transition: (
        previous: SlidingWindowLog | undefined,
      ) => StateTransition<SlidingWindowLog, TResult>,
    ): Promise<TResult> {
      return inner.update(key, ttlMs, (previous) => {
        const next = transition(previous);
        lengths.push(next.state.length);
        return next;
      });
    },
  };
}

/** Small seeded PRNG so the randomised test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
