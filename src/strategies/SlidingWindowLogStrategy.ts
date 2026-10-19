import type { LimitPolicy, RateLimitResult } from '@/domain';
import type { Clock, RateLimitStore, RateLimitStrategy } from '@/interfaces';

/** Timestamps (ms) of allowed requests, oldest first. */
export type SlidingWindowLog = readonly number[];

/**
 * Strategy: sliding window log. Guarantees at most `limit` allowed requests in any `windowMs` span
 * and returns the exact wait. Denied requests are not recorded, so retries don't extend the wait.
 */
export class SlidingWindowLogStrategy implements RateLimitStrategy {
  public constructor(
    private readonly store: RateLimitStore<SlidingWindowLog>,
    private readonly clock: Clock,
  ) {}

  public consume(key: string, { limit, windowMs }: LimitPolicy): Promise<RateLimitResult> {
    const now = this.clock.now();

    return this.store.update<RateLimitResult>(key, windowMs, (previous = []) => {
      const live = previous.filter((timestamp) => timestamp > now - windowMs);

      if (live.length < limit) {
        const state = [...live, now];
        const oldest = state[0] ?? now;
        return {
          state,
          result: {
            allowed: true,
            limit,
            remaining: limit - state.length,
            resetMs: oldest + windowMs - now,
            retryAfterMs: 0,
          },
        };
      }

      const waitMs = live[0] === undefined ? 0 : live[0] + windowMs - now;
      return {
        state: live,
        result: { allowed: false, limit, remaining: 0, resetMs: waitMs, retryAfterMs: waitMs },
      };
    });
  }
}
