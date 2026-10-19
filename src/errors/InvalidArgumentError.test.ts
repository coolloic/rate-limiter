import { describe, expect, it } from 'vitest';

import { AppError } from './AppError';
import { InvalidArgumentError } from './InvalidArgumentError';
import { RateLimitError } from './RateLimitError';

describe('InvalidArgumentError', () => {
  it('is an AppError but not a RateLimitError', () => {
    const error = new InvalidArgumentError('maxAttempts must be >= 1');

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RateLimitError);
  });

  it('uses the concrete class name and the given message', () => {
    const error = new InvalidArgumentError('maxAttempts must be >= 1');

    expect(error.name).toBe('InvalidArgumentError');
    expect(error.message).toBe('maxAttempts must be >= 1');
  });

  it('passes the cause through', () => {
    const cause = new Error('parse failed');

    expect(new InvalidArgumentError('bad', { cause }).cause).toBe(cause);
  });
});
