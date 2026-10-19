import { withRateLimit, type RateLimiter } from 'coding-challenge-loic-wong';

/** What the upstream service returns for one report. */
export interface Report {
  readonly id: string;
  readonly title: string;
}

/** Port: the one call `/api/report` makes to the upstream service. */
export interface UpstreamClient {
  fetchReport(id: string): Promise<Report>;
}

/** What the `/api/report` route depends on: fetch one report (it may reject with `RateLimitTimeoutError`). */
export type FetchReport = (id: string) => Promise<Report>;

// One shared quota for every upstream call the server makes, whoever the inbound consumer is.
const UPSTREAM_CONSUMER = { consumerId: 'upstream' };

/**
 * Decorator (the library's `withRateLimit`): each call waits for a slot in `limiter` before reaching `upstream`,
 * so the server never exceeds the upstream's quota. When the wait would exceed `maxWaitMs` it rejects with
 * `RateLimitTimeoutError` and `upstream` is not called. Build it once and share it across requests.
 */
export function rateLimitedFetchReport(
  upstream: UpstreamClient,
  limiter: Pick<RateLimiter, 'check'>,
  maxWaitMs: number,
): FetchReport {
  return withRateLimit(limiter, UPSTREAM_CONSUMER, (id: string) => upstream.fetchReport(id), {
    maxWaitMs,
  });
}
