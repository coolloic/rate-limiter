import { describe, expect, it } from 'vitest';

import type { PolicyResolver, RateLimitStrategy } from '@/interfaces';

import { RateLimiter } from './RateLimiter';
import { DEFAULT_RESOURCE, type Consumer, type LimitPolicy, type RateLimitResult } from './types';

const POLICY: LimitPolicy = { limit: 5, windowMs: 1_000 };
const ALLOWED: RateLimitResult = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetMs: 1_000,
  retryAfterMs: 0,
};
const DENIED: RateLimitResult = {
  allowed: false,
  limit: 5,
  remaining: 0,
  resetMs: 1_000,
  retryAfterMs: 250,
};

class FakePolicyResolver implements PolicyResolver {
  public readonly calls: Consumer[] = [];

  public constructor(private readonly policy: LimitPolicy) {}

  public resolve(consumer: Consumer): LimitPolicy {
    this.calls.push(consumer);
    return this.policy;
  }
}

class FakeStrategy implements RateLimitStrategy {
  public readonly calls: { readonly key: string; readonly policy: LimitPolicy }[] = [];

  public constructor(private readonly result: RateLimitResult) {}

  public consume(key: string, policy: LimitPolicy): Promise<RateLimitResult> {
    this.calls.push({ key, policy });
    return Promise.resolve(this.result);
  }
}

function setup(result: RateLimitResult = ALLOWED): {
  readonly limiter: RateLimiter;
  readonly resolver: FakePolicyResolver;
  readonly strategy: FakeStrategy;
} {
  const resolver = new FakePolicyResolver(POLICY);
  const strategy = new FakeStrategy(result);
  return { limiter: new RateLimiter(resolver, strategy), resolver, strategy };
}

async function keyOf(consumer: Consumer): Promise<string | undefined> {
  const { limiter, strategy } = setup();
  await limiter.check(consumer);
  return strategy.calls[0]?.key;
}

describe('RateLimiter', () => {
  it('passes the consumer to the policy resolver', async () => {
    const { limiter, resolver } = setup();
    const consumer: Consumer = { consumerId: 'alice', resource: 'search' };

    await limiter.check(consumer);

    expect(resolver.calls).toEqual([consumer]);
  });

  it('consumes once with the resolved policy', async () => {
    const { limiter, strategy } = setup();

    await limiter.check({ consumerId: 'alice' });

    expect(strategy.calls).toHaveLength(1);
    expect(strategy.calls[0]?.policy).toBe(POLICY);
  });

  it('keys on the resource and consumer ID', async () => {
    expect(await keyOf({ consumerId: 'alice', resource: 'search' })).toBe('["search","alice"]');
  });

  it('defaults the resource to DEFAULT_RESOURCE', async () => {
    expect(await keyOf({ consumerId: 'alice' })).toBe(JSON.stringify([DEFAULT_RESOURCE, 'alice']));
  });

  it('shares a key between an omitted resource and an explicit DEFAULT_RESOURCE', async () => {
    expect(await keyOf({ consumerId: 'x' })).toBe(
      await keyOf({ consumerId: 'x', resource: DEFAULT_RESOURCE }),
    );
  });

  it('produces distinct keys whatever characters the IDs contain', async () => {
    const consumers: readonly Consumer[] = [
      { resource: 'a:b', consumerId: 'c' },
      { resource: 'a', consumerId: 'b:c' },
      { resource: 'a","b', consumerId: 'c' },
      { resource: 'a', consumerId: 'b","c' },
      { resource: 'a,b', consumerId: 'c' },
      { resource: 'a', consumerId: 'b,c' },
      { resource: 'a"]', consumerId: '["c' },
      { resource: 'a', consumerId: '"]["c' },
      { resource: '', consumerId: 'a' },
      { resource: 'a', consumerId: '' },
    ];

    const keys = await Promise.all(consumers.map(keyOf));

    expect(keys).not.toContain(undefined);
    expect(new Set(keys).size).toBe(consumers.length);
  });

  it.each([
    ['allowed', ALLOWED],
    ['denied', DENIED],
  ])('returns the strategy result unchanged when %s', async (_label, result) => {
    const { limiter } = setup(result);

    await expect(limiter.check({ consumerId: 'alice' })).resolves.toBe(result);
  });
});
