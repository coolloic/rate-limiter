import type { Consumer, RateLimiter, RateLimitResult } from 'coding-challenge-loic-wong';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { rateLimitMiddleware } from './rateLimitMiddleware';
import { closeServers, listen } from './testServer';

const ALLOWED: RateLimitResult = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetMs: 1000,
  retryAfterMs: 0,
};
const DENIED: RateLimitResult = {
  allowed: false,
  limit: 5,
  remaining: 0,
  resetMs: 1500,
  retryAfterMs: 1500,
};

/** Hand-written fake: records every consumer it is asked about and answers with `respond`. */
class FakeLimiter implements Pick<RateLimiter, 'check'> {
  public readonly calls: Consumer[] = [];

  public constructor(private readonly respond: () => Promise<RateLimitResult>) {}

  public check(consumer: Consumer): Promise<RateLimitResult> {
    this.calls.push(consumer);
    return this.respond();
  }
}

let routeHits = 0;

// Mounts the middleware in front of a route that counts its hits and echoes the consumer ID.
async function serve(limiter: Pick<RateLimiter, 'check'>, resource?: string): Promise<string> {
  const app = express();
  app.get('/r', rateLimitMiddleware(limiter, resource), (_req, res) => {
    routeHits += 1;
    res.json({ consumerId: res.locals.consumerId });
  });
  return listen(app);
}

function get(baseUrl: string, consumerId?: string): Promise<Response> {
  return fetch(`${baseUrl}/r`, {
    headers: consumerId === undefined ? {} : { 'X-Consumer-Id': consumerId },
  });
}

afterEach(async () => {
  routeHits = 0;
  await closeServers();
});

describe('rateLimitMiddleware', () => {
  it('checks the consumer and resource, sets the headers and reaches the route when allowed', async () => {
    const limiter = new FakeLimiter(() => Promise.resolve(ALLOWED));
    const baseUrl = await serve(limiter, 'search');

    const response = await get(baseUrl, 'alice');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ consumerId: 'alice' });
    expect(limiter.calls).toEqual([{ consumerId: 'alice', resource: 'search' }]);
    expect(response.headers.get('RateLimit-Limit')).toBe('5');
    expect(response.headers.get('RateLimit-Remaining')).toBe('4');
    expect(response.headers.get('RateLimit-Reset')).toBe('1');
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('checks the consumer without a resource when none is given', async () => {
    const limiter = new FakeLimiter(() => Promise.resolve(ALLOWED));
    const baseUrl = await serve(limiter);

    await get(baseUrl, 'alice');

    expect(limiter.calls).toEqual([{ consumerId: 'alice' }]);
  });

  it('answers 429 JSON with retryAfterMs and Retry-After when denied, without reaching the route', async () => {
    const baseUrl = await serve(new FakeLimiter(() => Promise.resolve(DENIED)));

    const response = await get(baseUrl, 'alice');

    expect(response.status).toBe(429);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: 'Too Many Requests', retryAfterMs: 1500 });
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(response.headers.get('RateLimit-Remaining')).toBe('0');
    expect(routeHits).toBe(0);
  });

  it('answers 400 JSON for an invalid consumer ID without calling the limiter', async () => {
    const limiter = new FakeLimiter(() => Promise.resolve(ALLOWED));
    const baseUrl = await serve(limiter);

    const response = await get(baseUrl, 'not valid!');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing or invalid X-Consumer-Id header' });
    expect(limiter.calls).toEqual([]);
    expect(routeHits).toBe(0);
  });

  it.each([
    ['rejects', (): Promise<RateLimitResult> => Promise.reject(new Error('store down'))],
    [
      'throws synchronously',
      (): Promise<RateLimitResult> => {
        throw new Error('broken');
      },
    ],
  ])('fails closed with 503 JSON when check %s', async (_label, respond) => {
    const baseUrl = await serve(new FakeLimiter(respond));

    const response = await get(baseUrl, 'alice');

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: 'Rate limiter unavailable' });
    expect(routeHits).toBe(0);
  });
});
