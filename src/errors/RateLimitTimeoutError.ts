import type { RateLimitResult } from '@/domain';

import { RateLimitError } from './RateLimitError';

/** The denied branch of `RateLimitResult`. */
export type DeniedRateLimitResult = Extract<RateLimitResult, { readonly allowed: false }>;

/** Thrown by `acquire` when waiting for a slot would exceed its limits. */
export class RateLimitTimeoutError extends RateLimitError {
  public constructor(
    public readonly lastResult: DeniedRateLimitResult,
    options?: ErrorOptions,
  ) {
    super(`Rate limit still exceeded; next slot in ${String(lastResult.retryAfterMs)} ms`, options);
  }
}
