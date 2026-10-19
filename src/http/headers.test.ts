import { describe, expect, it } from 'vitest';

import type { RateLimitResult } from '@/domain';

import { toRateLimitHeaders } from './headers';

function allowed(remaining: number, resetMs: number): RateLimitResult {
  return { allowed: true, limit: 10, remaining, resetMs, retryAfterMs: 0 };
}

function denied(resetMs: number, retryAfterMs: number): RateLimitResult {
  return { allowed: false, limit: 10, remaining: 0, resetMs, retryAfterMs };
}

describe('toRateLimitHeaders', () => {
  it('emits the RateLimit headers without Retry-After when allowed', () => {
    expect(toRateLimitHeaders(allowed(7, 30_000))).toEqual({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '7',
      'RateLimit-Reset': '30',
    });
  });

  it('adds Retry-After when denied', () => {
    expect(toRateLimitHeaders(denied(2000, 2000))).toEqual({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '2',
      'Retry-After': '2',
    });
  });

  it('omits Retry-After when the last unit is used (allowed with remaining 0)', () => {
    const headers = toRateLimitHeaders(allowed(0, 1000));
    expect(headers).toEqual({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '1',
    });
    expect(headers).not.toHaveProperty('Retry-After');
  });

  it.each([
    [1, '1'],
    [999, '1'],
    [1000, '1'],
    [1001, '2'],
  ])('rounds %i ms up to %s second(s) so clients never retry early', (ms, seconds) => {
    const headers = toRateLimitHeaders(denied(ms, ms));
    expect(headers['RateLimit-Reset']).toBe(seconds);
    expect(headers['Retry-After']).toBe(seconds);
  });

  it('reports a reset of 0 when nothing is consumed', () => {
    expect(toRateLimitHeaders(allowed(10, 0))['RateLimit-Reset']).toBe('0');
  });

  it('returns only string values', () => {
    const values = Object.values(toRateLimitHeaders(denied(1500, 1500)));
    expect(values).toHaveLength(4);
    for (const value of values) expect(typeof value).toBe('string');
  });
});
