import { describe, expect, it } from 'vitest';

import { AppError } from './AppError';
import { RateLimitError } from './RateLimitError';
import { type DeniedRateLimitResult, RateLimitTimeoutError } from './RateLimitTimeoutError';

const denied: DeniedRateLimitResult = {
  allowed: false,
  limit: 10,
  remaining: 0,
  resetMs: 1500,
  retryAfterMs: 250,
};

describe('RateLimitTimeoutError', () => {
  it('is a RateLimitError, an AppError and an Error', () => {
    const error = new RateLimitTimeoutError(denied);

    expect(error).toBeInstanceOf(RateLimitTimeoutError);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('uses the concrete class name', () => {
    expect(new RateLimitTimeoutError(denied).name).toBe('RateLimitTimeoutError');
  });

  it('carries the last denied result', () => {
    expect(new RateLimitTimeoutError(denied).lastResult).toBe(denied);
  });

  it('says when the next slot frees up', () => {
    expect(new RateLimitTimeoutError(denied).message).toBe(
      'Rate limit still exceeded; next slot in 250 ms',
    );
  });

  it('passes the cause through', () => {
    const cause = new Error('aborted');

    expect(new RateLimitTimeoutError(denied, { cause }).cause).toBe(cause);
  });
});
