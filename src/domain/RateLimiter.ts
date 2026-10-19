import type { PolicyResolver, RateLimitStrategy } from '@/interfaces';

import { DEFAULT_RESOURCE, type Consumer, type RateLimitResult } from './types';

/** Checks a consumer against its policy, delegating the algorithm to a `RateLimitStrategy`. */
export class RateLimiter {
  public constructor(
    private readonly policies: PolicyResolver,
    private readonly strategy: RateLimitStrategy,
  ) {}

  public check(consumer: Consumer): Promise<RateLimitResult> {
    const { consumerId, resource = DEFAULT_RESOURCE } = consumer;
    // JSON encoding keeps keys unambiguous whatever characters the IDs contain.
    const key = JSON.stringify([resource, consumerId]);
    return this.strategy.consume(key, this.policies.resolve(consumer));
  }
}
