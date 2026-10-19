import { RateLimiter, SystemClock, type LimitPolicy } from '@/domain';
import type { Clock, PolicyResolver, RateLimitStore } from '@/interfaces';
import { ConfigurablePolicyResolver } from '@/policies';
import { InMemoryStore } from '@/stores';
import { SlidingWindowLogStrategy, type SlidingWindowLog } from '@/strategies';

interface CommonOptions {
  /** Defaults to `SystemClock`. */
  readonly clock?: Clock;
  /** Defaults to an in-process `InMemoryStore`. Swap for a shared store when running several instances. */
  readonly store?: RateLimitStore<SlidingWindowLog>;
}

/** Either one policy for everyone (`defaultPolicy`) or a full `PolicyResolver` (`policies`), never both. */
export type RateLimiterOptions = CommonOptions &
  (
    | { readonly defaultPolicy: LimitPolicy; readonly policies?: never }
    | { readonly policies: PolicyResolver; readonly defaultPolicy?: never }
  );

/**
 * Factory: the single place that picks concrete classes. It never reads config; the caller passes the policy.
 * @throws InvalidArgumentError if `defaultPolicy` is not a pair of positive integers.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const clock = options.clock ?? new SystemClock();
  const store = options.store ?? new InMemoryStore<SlidingWindowLog>(clock);
  const policies =
    options.policies ?? new ConfigurablePolicyResolver({ default: options.defaultPolicy });
  return new RateLimiter(policies, new SlidingWindowLogStrategy(store, clock));
}
