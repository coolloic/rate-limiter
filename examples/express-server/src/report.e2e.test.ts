import {
  createRateLimiter,
  SystemClock,
  type LimitPolicy,
  type RateLimiter,
} from 'coding-challenge-loic-wong';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { FakeUpstreamClient } from './FakeUpstreamClient';
import { closeServers, listen } from './testServer';
import { rateLimitedFetchReport, type UpstreamClient } from './upstream';

// Inbound limit high enough that only the upstream limit matters, unless a test says otherwise.
const GENEROUS: LimitPolicy = { limit: 100, windowMs: 60_000 };
// Slack allowed on timing assertions (HTTP round trips, timer jitter).
const MARGIN_MS = 40;
// The fake records a call a moment after the limiter records its slot, so recorded gaps may be a little shorter.
const RECORDING_SLACK_MS = 5;

afterEach(closeServers);

interface ReportApp {
  readonly inbound?: LimitPolicy;
  readonly upstreamPolicy: LimitPolicy;
  readonly maxWaitMs: number;
  readonly upstream?: UpstreamClient;
}

// Starts the app with fresh limiters; the wrapped upstream call is built once, as `main.ts` does.
async function startApp(options: ReportApp): Promise<string> {
  const limiter = createRateLimiter({ defaultPolicy: options.inbound ?? GENEROUS });
  const upstreamLimiter = createRateLimiter({ defaultPolicy: options.upstreamPolicy });
  const upstream = options.upstream ?? new FakeUpstreamClient(new SystemClock());
  const fetchReport = rateLimitedFetchReport(upstream, upstreamLimiter, options.maxWaitMs);
  return listen(createApp({ limiter, fetchReport }));
}

function getReport(baseUrl: string, id: string, consumerId = 'alice'): Promise<Response> {
  return fetch(`${baseUrl}/api/report/${id}`, { headers: { 'X-Consumer-Id': consumerId } });
}

function burst(baseUrl: string, count: number): Promise<Response[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => getReport(baseUrl, `r${String(i)}`)));
}

// A JSON object body, narrowed from `unknown` (external input).
async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null)
    throw new Error(`Not a JSON object: ${String(body)}`);
  return Object.fromEntries(Object.entries(body));
}

function expectRateLimitHeaders(response: Response): void {
  expect(response.headers.get('RateLimit-Limit')).not.toBeNull();
  expect(response.headers.get('RateLimit-Remaining')).not.toBeNull();
  expect(response.headers.get('RateLimit-Reset')).not.toBeNull();
}

describe('GET /api/report/:id', () => {
  it('returns the report as JSON with the inbound RateLimit headers', async () => {
    const baseUrl = await startApp({ upstreamPolicy: { limit: 5, windowMs: 300 }, maxWaitMs: 100 });

    const response = await getReport(baseUrl, 'r1');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ id: 'r1', title: 'Report r1' });
    expect(response.headers.get('RateLimit-Limit')).toBe('100');
    expect(response.headers.get('RateLimit-Remaining')).toBe('99');
  });

  it('#11 a burst all succeeds while upstream calls never exceed the upstream limit', async () => {
    const policy = { limit: 3, windowMs: 300 };
    const upstream = new FakeUpstreamClient(new SystemClock());
    const baseUrl = await startApp({ upstreamPolicy: policy, maxWaitMs: 2000, upstream });

    const startedAt = Date.now();
    const responses = await burst(baseUrl, 7);
    const elapsedMs = Date.now() - startedAt;

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    const times = upstream.callTimes();
    expect(times).toHaveLength(7);
    // Every span of `windowMs` holds at most `limit` calls: call i and call i + limit are a window apart.
    for (let i = 0; i + policy.limit < times.length; i += 1) {
      const gap = (times[i + policy.limit] ?? 0) - (times[i] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(policy.windowMs - RECORDING_SLACK_MS);
    }
    // 7 calls at 3 per window: batches at ≈ 0, 300 and 600 ms.
    expect(elapsedMs).toBeGreaterThanOrEqual(2 * policy.windowMs - MARGIN_MS);
    expect(elapsedMs).toBeLessThan(3 * policy.windowMs + 2 * MARGIN_MS);
  });

  it('#12 when the wait would exceed maxWaitMs: 503 with Retry-After, and no unthrottled upstream call', async () => {
    const policy = { limit: 2, windowMs: 300 };
    const upstream = new FakeUpstreamClient(new SystemClock());
    const baseUrl = await startApp({ upstreamPolicy: policy, maxWaitMs: 100, upstream });

    const responses = await burst(baseUrl, 5);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 503, 503, 503]);
    for (const response of responses.filter((r) => r.status === 503)) {
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expectRateLimitHeaders(response);
      const body = await jsonObject(response);
      expect(Object.keys(body).sort()).toEqual(['error', 'retryAfterMs']);
      expect(body.error).toBe('Upstream rate limit exceeded');
      expect(body.retryAfterMs).toBeGreaterThan(0);
      expect(body.retryAfterMs).toBeLessThanOrEqual(policy.windowMs);
    }
    expect(upstream.callTimes()).toHaveLength(policy.limit);
  });

  it('maps any other upstream error to 502 without leaking its message', async () => {
    const failing: UpstreamClient = {
      fetchReport: () => Promise.reject(new Error('db password is hunter2')),
    };
    const baseUrl = await startApp({
      upstreamPolicy: { limit: 5, windowMs: 300 },
      maxWaitMs: 100,
      upstream: failing,
    });

    const response = await getReport(baseUrl, 'r1');

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expectRateLimitHeaders(response);
    expect(await response.json()).toEqual({ error: 'Upstream request failed' });
  });

  it.each([
    ['too long', 'a'.repeat(65)],
    ['bad charset', 'r1%24'],
    ['encoded slash', 'a%2Fb'],
  ])('rejects an invalid id (%s) with 400 and never calls the upstream', async (_label, id) => {
    const upstream = new FakeUpstreamClient(new SystemClock());
    const baseUrl = await startApp({
      upstreamPolicy: { limit: 5, windowMs: 300 },
      maxWaitMs: 100,
      upstream,
    });

    const response = await getReport(baseUrl, id);

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: 'Invalid report id' });
    expectRateLimitHeaders(response);
    expect(upstream.callTimes()).toEqual([]);
  });

  it('accepts a 64-character id', async () => {
    const baseUrl = await startApp({ upstreamPolicy: { limit: 5, windowMs: 300 }, maxWaitMs: 100 });

    const response = await getReport(baseUrl, 'a'.repeat(64));

    expect(response.status).toBe(200);
  });

  it('the inbound consumer limit applies first: 429 before the upstream is touched', async () => {
    const upstream = new FakeUpstreamClient(new SystemClock());
    const baseUrl = await startApp({
      inbound: { limit: 1, windowMs: 60_000 },
      upstreamPolicy: { limit: 5, windowMs: 300 },
      maxWaitMs: 100,
      upstream,
    });

    const first = await getReport(baseUrl, 'r1');
    const second = await getReport(baseUrl, 'r2');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect((await jsonObject(second)).error).toBe('Too Many Requests');
    expect(upstream.callTimes()).toHaveLength(1);
  });

  it('counts inbound requests per consumer under the report resource', async () => {
    const limiter: Pick<RateLimiter, 'check'> = createRateLimiter({
      defaultPolicy: { limit: 1, windowMs: 60_000 },
    });
    const upstreamLimiter = createRateLimiter({ defaultPolicy: { limit: 5, windowMs: 300 } });
    const fetchReport = rateLimitedFetchReport(
      new FakeUpstreamClient(new SystemClock()),
      upstreamLimiter,
      100,
    );
    const baseUrl = await listen(createApp({ limiter, fetchReport }));

    // /api/resource has its own quota, and bob has his own.
    await fetch(`${baseUrl}/api/resource`, { headers: { 'X-Consumer-Id': 'alice' } });
    const alice = await getReport(baseUrl, 'r1', 'alice');
    const bob = await getReport(baseUrl, 'r1', 'bob');

    expect([alice.status, bob.status]).toEqual([200, 200]);
  });
});
