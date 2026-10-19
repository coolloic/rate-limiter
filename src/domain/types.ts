/** Resource used when a `Consumer` does not name one. */
export const DEFAULT_RESOURCE = 'default';

/** An identified consumer of an (optionally named) resource. */
export interface Consumer {
  readonly consumerId: string;
  /** Defaults to {@link DEFAULT_RESOURCE}. */
  readonly resource?: string;
}

/** At most `limit` requests in any `windowMs` span. */
export interface LimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

interface RateLimitResultBase {
  readonly limit: number;
  /** Ms until at least one quota unit frees up (0 when nothing is consumed). */
  readonly resetMs: number;
}

/** Outcome of one rate-limit check, discriminated on `allowed`. */
export type RateLimitResult =
  | (RateLimitResultBase & {
      readonly allowed: true;
      readonly remaining: number;
      readonly retryAfterMs: 0;
    })
  | (RateLimitResultBase & {
      readonly allowed: false;
      readonly remaining: 0;
      readonly retryAfterMs: number;
    });
