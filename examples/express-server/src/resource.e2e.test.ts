import {
  createRateLimiter,
  type RateLimiter,
  type RateLimitStore,
  type SlidingWindowLog,
} from 'coding-challenge-loic-wong';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { rateLimitMiddleware } from './rateLimitMiddleware';
import { closeServers, listen } from './testServer';

// Short real windows keep the suite fast; a fresh limiter per test keeps tests isolated.
const POLICY = { limit: 5, windowMs: 300 };
// Slack added to waits and allowed on timing assertions (HTTP round trips, timer jitter).
const MARGIN_MS = 40;

afterEach(closeServers);

function newLimiter(): RateLimiter {
  return createRateLimiter({ defaultPolicy: POLICY });
}

async function startApp(limiter: Pick<RateLimiter, 'check'> = newLimiter()): Promise<string> {
  return listen(createApp({ limiter }));
}

function get(baseUrl: string, consumerId = 'alice', path = '/api/resource'): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { 'X-Consumer-Id': consumerId } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The JSON body of a 429: `retryAfterMs` narrowed from `unknown` (external input).
async function retryAfterMsOf(response: Response): Promise<number> {
  const body: unknown = await response.json();
  const value: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'retryAfterMs') : undefined;
  if (typeof value !== 'number') throw new Error(`No numeric retryAfterMs in ${String(body)}`);
  return value;
}

async function statuses(responses: Promise<Response>[]): Promise<number[]> {
  return (await Promise.all(responses)).map((response) => response.status);
}

// Sends `count` requests one after another and returns them.
async function sequential(count: number, send: () => Promise<Response>): Promise<Response[]> {
  const responses: Response[] = [];
  for (let i = 0; i < count; i += 1) responses.push(await send());
  return responses;
}

describe('GET /api/resource', () => {
  it('#1 allows requests with RateLimit headers while remaining counts down', async () => {
    const baseUrl = await startApp();

    const responses = await sequential(POLICY.limit, () => get(baseUrl));

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(responses.map((r) => r.headers.get('RateLimit-Remaining'))).toEqual([
      '4',
      '3',
      '2',
      '1',
      '0',
    ]);
    for (const response of responses) {
      expect(response.headers.get('RateLimit-Limit')).toBe('5');
      expect(response.headers.get('RateLimit-Reset')).toBe('1'); // 300 ms, rounded up to seconds
    }
    expect(await responses[0]?.json()).toEqual({ resource: 'resource', consumerId: 'alice' });
  });

  it('#2 the request that reaches remaining 0 is still 200, without Retry-After', async () => {
    const baseUrl = await startApp();

    const last = (await sequential(POLICY.limit, () => get(baseUrl))).at(-1);

    expect(last?.status).toBe(200);
    expect(last?.headers.get('RateLimit-Remaining')).toBe('0');
    expect(last?.headers.get('Retry-After')).toBeNull();
  });

  it('#3 the next request is 429 with Retry-After, RateLimit-Remaining 0 and a JSON retryAfterMs', async () => {
    const baseUrl = await startApp();
    await sequential(POLICY.limit, () => get(baseUrl));

    const denied = await get(baseUrl);

    expect(denied.status).toBe(429);
    expect(denied.headers.get('content-type')).toMatch(/^application\/json/);
    expect(denied.headers.get('Retry-After')).toBe('1'); // ≤ 300 ms, rounded up to seconds
    expect(denied.headers.get('RateLimit-Remaining')).toBe('0');
    expect(denied.headers.get('RateLimit-Limit')).toBe('5');
    const retryAfterMs = await retryAfterMsOf(denied);
    expect(retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs).toBeLessThanOrEqual(POLICY.windowMs);
  });

  it('#4 allows requests again after waiting retryAfterMs', async () => {
    const baseUrl = await startApp();
    await sequential(POLICY.limit, () => get(baseUrl));
    const retryAfterMs = await retryAfterMsOf(await get(baseUrl));

    await sleep(retryAfterMs + MARGIN_MS);
    const again = await get(baseUrl);

    expect(again.status).toBe(200);
  });

  it('#5 sliding window: slots free up as their requests age out, not all at once', async () => {
    const baseUrl = await startApp();
    await sequential(2, () => get(baseUrl)); // t0
    await sleep(150);
    await sequential(3, () => get(baseUrl)); // ≈ t0 + 150 ms
    const denied = await get(baseUrl);
    expect(denied.status).toBe(429);

    // Wait until the first two have left the window (≈ t0 + 300 ms); the later three are still in it.
    await sleep((await retryAfterMsOf(denied)) + MARGIN_MS);
    const after = await statuses([get(baseUrl), get(baseUrl), get(baseUrl)]);

    expect(after.sort()).toEqual([200, 200, 429]);
  });

  it('#6 hammering while blocked does not extend the wait', async () => {
    const baseUrl = await startApp();
    await sequential(POLICY.limit, () => get(baseUrl));
    const blockedAt = Date.now();
    const firstWait = await retryAfterMsOf(await get(baseUrl));

    const waits: number[] = [];
    while (Date.now() - blockedAt < 150) {
      waits.push(await retryAfterMsOf(await get(baseUrl)));
      await sleep(10);
    }

    // Every denied request reports a wait that keeps shrinking with elapsed time.
    for (let i = 1; i < waits.length; i += 1) {
      expect(waits[i]).toBeLessThanOrEqual(waits[i - 1] ?? Infinity);
    }
    expect(waits.at(-1)).toBeLessThanOrEqual(firstWait - 100);
    // And the original deadline still holds.
    await sleep(Math.max(0, blockedAt + firstWait - Date.now()) + MARGIN_MS);
    expect((await get(baseUrl)).status).toBe(200);
  });

  it('#7 consumers are isolated: alice blocked, bob allowed', async () => {
    const baseUrl = await startApp();
    await sequential(POLICY.limit, () => get(baseUrl, 'alice'));

    const alice = await get(baseUrl, 'alice');
    const bob = await get(baseUrl, 'bob');

    expect(alice.status).toBe(429);
    expect(bob.status).toBe(200);
    expect(bob.headers.get('RateLimit-Remaining')).toBe('4');
  });

  it('#7 resources are isolated: one limiter, two routes with their own resource', async () => {
    const limiter = newLimiter();
    const app = express();
    for (const resource of ['a', 'b']) {
      app.get(`/${resource}`, rateLimitMiddleware(limiter, resource), (_req, res) => {
        res.json({ resource });
      });
    }
    const baseUrl = await listen(app);
    await sequential(POLICY.limit, () => get(baseUrl, 'alice', '/a'));

    const a = await get(baseUrl, 'alice', '/a');
    const b = await get(baseUrl, 'alice', '/b');

    expect(a.status).toBe(429);
    expect(b.status).toBe(200);
    expect(b.headers.get('RateLimit-Remaining')).toBe('4');
  });

  it('#8 a concurrent burst allows exactly `limit` requests and rejects the rest', async () => {
    const baseUrl = await startApp();

    const burst = await statuses(Array.from({ length: 12 }, () => get(baseUrl)));

    expect(burst.filter((status) => status === 200)).toHaveLength(POLICY.limit);
    expect(burst.filter((status) => status === 429)).toHaveLength(12 - POLICY.limit);
  });

  describe('#9 an invalid X-Consumer-Id is rejected with 400 and uses no quota', () => {
    const duplicated = new Headers();
    duplicated.append('X-Consumer-Id', 'alice');
    duplicated.append('X-Consumer-Id', 'alice');

    it.each<[string, HeadersInit]>([
      ['missing', {}],
      ['empty', { 'X-Consumer-Id': '' }],
      ['too long', { 'X-Consumer-Id': 'a'.repeat(65) }],
      ['bad charset', { 'X-Consumer-Id': 'alice/../bob' }],
      ['duplicated', duplicated],
    ])('%s', async (_label, headers) => {
      const baseUrl = await startApp();

      const rejected = await fetch(`${baseUrl}/api/resource`, { headers });

      expect(rejected.status).toBe(400);
      expect(rejected.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await rejected.json()).toEqual({ error: 'Missing or invalid X-Consumer-Id header' });
      expect(rejected.headers.get('RateLimit-Remaining')).toBeNull();
      // No quota used: alice's first valid request still sees the full limit.
      expect((await get(baseUrl, 'alice')).headers.get('RateLimit-Remaining')).toBe('4');
    });
  });

  describe('#13 a failing limiter fails closed with 503 and never reaches the route', () => {
    it('when the store rejects', async () => {
      const store: RateLimitStore<SlidingWindowLog> = {
        update: () => Promise.reject(new Error('store unavailable')),
      };
      const baseUrl = await startApp(createRateLimiter({ defaultPolicy: POLICY, store }));

      const response = await get(baseUrl);

      expect(response.status).toBe(503);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await response.json()).toEqual({ error: 'Rate limiter unavailable' });
    });

    it('when check throws synchronously', async () => {
      const limiter: Pick<RateLimiter, 'check'> = {
        check: () => {
          throw new Error('limiter broken');
        },
      };
      const baseUrl = await startApp(limiter);

      const response = await get(baseUrl);

      expect(response.status).toBe(503);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await response.json()).toEqual({ error: 'Rate limiter unavailable' });
    });
  });
});
