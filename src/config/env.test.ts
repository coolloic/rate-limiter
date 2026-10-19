import { describe, expect, it } from 'vitest';

import { parseEnv } from './env';

describe('parseEnv', () => {
  it('applies defaults when variables are missing', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(parseEnv({}))).toBe(true);
  });

  it('rejects invalid values with a readable error', () => {
    expect(() => parseEnv({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('lists every invalid field in the error', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging', LOG_LEVEL: 'verbose' })).toThrow(
      /NODE_ENV[\s\S]*LOG_LEVEL/,
    );
  });

  it('treats empty strings as unset so defaults apply', () => {
    expect(parseEnv({ LOG_LEVEL: '' }).LOG_LEVEL).toBe('info');
  });

  describe('rate limit variables', () => {
    const fields = ['RATE_LIMIT_MAX_REQUESTS', 'RATE_LIMIT_WINDOW_MS'] as const;

    it('defaults to 10 requests per 1000 ms', () => {
      const env = parseEnv({});
      expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(10);
      expect(env.RATE_LIMIT_WINDOW_MS).toBe(1000);
    });

    it('coerces valid overrides from strings to numbers', () => {
      const env = parseEnv({ RATE_LIMIT_MAX_REQUESTS: '5', RATE_LIMIT_WINDOW_MS: '60000' });
      expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(5);
      expect(env.RATE_LIMIT_WINDOW_MS).toBe(60000);
    });

    it('treats empty strings as unset so defaults apply', () => {
      const env = parseEnv({ RATE_LIMIT_MAX_REQUESTS: '', RATE_LIMIT_WINDOW_MS: '' });
      expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(10);
      expect(env.RATE_LIMIT_WINDOW_MS).toBe(1000);
    });

    it.each(fields.flatMap((field) => ['0', '-1', '1.5', 'abc'].map((value) => [field, value])))(
      'rejects %s=%s naming the field',
      (field, value) => {
        expect(() => parseEnv({ [field]: value })).toThrow(new RegExp(field));
      },
    );
  });
});
