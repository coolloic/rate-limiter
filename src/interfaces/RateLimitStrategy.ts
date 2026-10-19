import type { LimitPolicy, RateLimitResult } from '@/domain';

/** Strategy port: a rate-limiting algorithm. */
export interface RateLimitStrategy {
  /** Decides whether one request for `key` may proceed under `policy`, recording it if so. */
  consume(key: string, policy: LimitPolicy): Promise<RateLimitResult>;
}
