import type { RateLimitResult } from '@/domain';

const MS_PER_SECOND = 1000;

/**
 * Maps a result to the IETF RateLimit header fields draft (`RateLimit-Limit`, `-Remaining`, `-Reset`
 * as delta-seconds), plus `Retry-After` (RFC 9110) only when denied. Seconds are rounded up so
 * clients never retry too early.
 */
export function toRateLimitHeaders(result: RateLimitResult): Readonly<Record<string, string>> {
  const headers = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(toSeconds(result.resetMs)),
  };
  if (result.allowed) return headers;
  return { ...headers, 'Retry-After': String(toSeconds(result.retryAfterMs)) };
}

function toSeconds(ms: number): number {
  return Math.ceil(ms / MS_PER_SECOND);
}
