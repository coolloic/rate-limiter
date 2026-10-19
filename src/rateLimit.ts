import { getConfig } from '@/config';
import type { Consumer, RateLimiter, RateLimitResult } from '@/domain';
import { createRateLimiter } from '@/factories';

// Lazy singleton: built on the first rateLimit() call, so importing this module has no side effects.
let limiter: RateLimiter | undefined;

/** Checks `consumer` against the default limiter (RATE_LIMIT_MAX_REQUESTS per RATE_LIMIT_WINDOW_MS). */
export function rateLimit(consumer: Consumer): Promise<RateLimitResult> {
  limiter ??= createDefaultLimiter();
  return limiter.check(consumer);
}

function createDefaultLimiter(): RateLimiter {
  const { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } = getConfig();
  return createRateLimiter({
    defaultPolicy: { limit: RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS },
  });
}
