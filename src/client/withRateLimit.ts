import type { Consumer, RateLimiter } from '@/domain';

import { acquire, type AcquireOptions } from './acquire';

/**
 * Decorator: wraps `fn` so each call first waits for a rate-limit slot via `acquire` (like p-limit's
 * `limit(fn)`, but for rate). `fn` may be sync or async. If `acquire` rejects, `fn` is not called.
 */
export function withRateLimit<TArgs extends readonly unknown[], TResult>(
  limiter: Pick<RateLimiter, 'check'>,
  consumer: Consumer,
  fn: (...args: TArgs) => TResult | Promise<TResult>,
  options: AcquireOptions = {},
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    await acquire(limiter, consumer, options);
    return fn(...args);
  };
}
