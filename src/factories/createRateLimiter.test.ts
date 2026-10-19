import { describe, expect, it } from 'vitest';

import type { Consumer, LimitPolicy, RateLimitResult } from '@/domain';
import { InvalidArgumentError } from '@/errors';
import type { Clock, PolicyResolver, RateLimitStore, StateTransition } from '@/interfaces';
import { InMemoryStore } from '@/stores';
import type { SlidingWindowLog } from '@/strategies';
import { FakeClock } from '@/testing';

import { createRateLimiter } from './createRateLimiter';

const alice: Consumer = { consumerId: 'alice' };
const tenPerSecond: LimitPolicy = { limit: 10, windowMs: 1000 };

async function checkTimes(
  limiter: { check(consumer: Consumer): Promise<RateLimitResult> },
  consumer: Consumer,
  times: number,
): Promise<RateLimitResult[]> {
  const results: RateLimitResult[] = [];
  for (let i = 0; i < times; i++) results.push(await limiter.check(consumer));
  return results;
}

/** Fake resolver: one fixed policy for everyone, recording who was resolved. */
class FixedPolicyResolver implements PolicyResolver {
  public readonly resolved: Consumer[] = [];

  public constructor(private readonly policy: LimitPolicy) {}

  public resolve(consumer: Consumer): LimitPolicy {
    this.resolved.push(consumer);
    return this.policy;
  }
}

/** Fake store: delegates to an `InMemoryStore` and records every key it is asked to update. */
class RecordingStore implements RateLimitStore<SlidingWindowLog> {
  public readonly keys: string[] = [];
  private readonly inner: InMemoryStore<SlidingWindowLog>;

  public constructor(clock: Clock) {
    this.inner = new InMemoryStore<SlidingWindowLog>(clock);
  }

  public update<TResult>(
    key: string,
    ttlMs: number,
    transition: (
      previous: SlidingWindowLog | undefined,
    ) => StateTransition<SlidingWindowLog, TResult>,
  ): Promise<TResult> {
    this.keys.push(key);
    return this.inner.update(key, ttlMs, transition);
  }
}

describe('createRateLimiter', () => {
  it('wires a working sliding-window limiter from defaultPolicy and the injected clock', async () => {
    const clock = new FakeClock(5_000);
    const limiter = createRateLimiter({ defaultPolicy: tenPerSecond, clock });

    const burst = await checkTimes(limiter, alice, 10);
    expect(burst.every((result) => result.allowed)).toBe(true);

    clock.advance(400);
    const denied = await limiter.check(alice);
    expect(denied).toEqual({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetMs: 600,
      retryAfterMs: 600,
    });

    clock.advance(600);
    expect((await limiter.check(alice)).allowed).toBe(true);
  });

  it('keeps quotas per consumer', async () => {
    const limiter = createRateLimiter({ defaultPolicy: tenPerSecond, clock: new FakeClock() });
    await checkTimes(limiter, alice, 10);
    expect((await limiter.check({ consumerId: 'bob' })).allowed).toBe(true);
  });

  it('uses the injected policies instead of a default policy', async () => {
    const policies = new FixedPolicyResolver({ limit: 2, windowMs: 1000 });
    const limiter = createRateLimiter({ policies, clock: new FakeClock() });

    const results = await checkTimes(limiter, alice, 3);
    expect(results.map((result) => result.allowed)).toEqual([true, true, false]);
    expect(policies.resolved).toEqual([alice, alice, alice]);
  });

  it('uses the injected store', async () => {
    const clock = new FakeClock();
    const store = new RecordingStore(clock);
    const limiter = createRateLimiter({ defaultPolicy: tenPerSecond, clock, store });

    await limiter.check({ consumerId: 'alice', resource: 'search' });
    expect(store.keys).toEqual([JSON.stringify(['search', 'alice'])]);
  });

  it.each([
    { limit: 0, windowMs: 1000 },
    { limit: 10, windowMs: -1 },
    { limit: 1.5, windowMs: 1000 },
  ])('rejects an invalid defaultPolicy %o with InvalidArgumentError', (defaultPolicy) => {
    expect(() => createRateLimiter({ defaultPolicy })).toThrow(InvalidArgumentError);
  });

  it('accepts either defaultPolicy or policies, but not both (type-level)', () => {
    const policies = new FixedPolicyResolver(tenPerSecond);
    // @ts-expect-error -- defaultPolicy would be silently ignored next to policies, so the type forbids it.
    expect(() => createRateLimiter({ defaultPolicy: tenPerSecond, policies })).not.toThrow();
  });
});
