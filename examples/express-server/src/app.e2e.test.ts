import { createRateLimiter, type RateLimiter } from 'coding-challenge-loic-wong';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { closeServers, listen } from './testServer';

afterEach(closeServers);

describe('GET /health', () => {
  it('returns 200 { status: "ok" } as JSON', async () => {
    const limiter = createRateLimiter({ defaultPolicy: { limit: 1, windowMs: 60_000 } });
    const baseUrl = await listen(createApp({ limiter }));

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is not rate limited: it never calls the limiter', async () => {
    const failing: Pick<RateLimiter, 'check'> = {
      check: () => Promise.reject(new Error('must not be called')),
    };
    const baseUrl = await listen(createApp({ limiter: failing }));

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('RateLimit-Limit')).toBeNull();
  });
});

describe('the library', () => {
  it('resolves through the package exports to the built dist/', () => {
    expect(import.meta.resolve('coding-challenge-loic-wong')).toMatch(/\/dist\/index\.js$/);
  });

  it('works through its public API', async () => {
    const limiter = createRateLimiter({ defaultPolicy: { limit: 1, windowMs: 60_000 } });

    const first = await limiter.check({ consumerId: 'alice' });
    const second = await limiter.check({ consumerId: 'alice' });

    expect([first.allowed, second.allowed]).toEqual([true, false]);
  });
});
