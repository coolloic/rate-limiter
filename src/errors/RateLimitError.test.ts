import { describe, expect, it } from 'vitest';

import { AppError } from './AppError';
import { RateLimitError } from './RateLimitError';

describe('RateLimitError', () => {
  it('is an AppError and an Error', () => {
    const error = new RateLimitError('too many requests');

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('uses the concrete class name and the given message', () => {
    const error = new RateLimitError('too many requests');

    expect(error.name).toBe('RateLimitError');
    expect(error.message).toBe('too many requests');
  });

  it('passes the cause through', () => {
    const cause = new Error('store unavailable');
    const error = new RateLimitError('too many requests', { cause });

    expect(error.cause).toBe(cause);
  });

  it('has no cause when none is given', () => {
    expect(new RateLimitError('too many requests').cause).toBeUndefined();
  });
});
