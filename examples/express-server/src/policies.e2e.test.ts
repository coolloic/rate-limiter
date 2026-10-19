import {
  ConfigurablePolicyResolver,
  createRateLimiter,
  InvalidArgumentError,
} from 'coding-challenge-loic-wong';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { closeServers, listen } from './testServer';

const WINDOW_MS = 300;
const RULES = {
  default: { limit: 5, windowMs: WINDOW_MS },
  resources: { search: { limit: 2, windowMs: WINDOW_MS } },
  consumers: { 'partner-acme': { limit: 8, windowMs: WINDOW_MS } },
  overrides: { search: { 'partner-acme': { limit: 4, windowMs: WINDOW_MS } } },
};

afterEach(closeServers);

// A fresh limiter per test keeps tests isolated.
async function startApp(): Promise<string> {
  const limiter = createRateLimiter({ policies: new ConfigurablePolicyResolver(RULES) });
  return listen(createApp({ limiter }));
}

// Sends requests one after another until the first 429 (or `max`), returning every response.
async function untilDenied(url: string, consumerId: string, max = 20): Promise<Response[]> {
  const responses: Response[] = [];
  for (let i = 0; i < max; i += 1) {
    const response = await fetch(url, { headers: { 'X-Consumer-Id': consumerId } });
    responses.push(response);
    if (response.status === 429) break;
  }
  return responses;
}

describe('#10 per-resource and per-consumer policies', () => {
  it.each([
    ['alice', '/api/search', 2, 'resource rule'],
    ['alice', '/api/resource', 5, 'default'],
    ['partner-acme', '/api/search', 4, 'override'],
    ['partner-acme', '/api/resource', 8, 'consumer rule'],
  ])('%s on %s gets %i requests (%s)', async (consumerId, path, limit) => {
    const baseUrl = await startApp();

    const responses = await untilDenied(`${baseUrl}${path}`, consumerId);

    expect(responses.map((r) => r.status)).toEqual([...Array<number>(limit).fill(200), 429]);
    for (const response of responses) {
      expect(response.headers.get('RateLimit-Limit')).toBe(String(limit));
    }
  });

  it('/api/search answers with its resource and the consumer', async () => {
    const baseUrl = await startApp();

    const response = await fetch(`${baseUrl}/api/search`, { headers: { 'X-Consumer-Id': 'bob' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resource: 'search', consumerId: 'bob' });
  });

  it('quotas per resource are independent', async () => {
    const baseUrl = await startApp();
    await untilDenied(`${baseUrl}/api/search`, 'alice');

    const resource = await untilDenied(`${baseUrl}/api/resource`, 'alice');
    const search = await fetch(`${baseUrl}/api/search`, { headers: { 'X-Consumer-Id': 'alice' } });

    expect(resource.filter((r) => r.status === 200)).toHaveLength(5);
    expect(search.status).toBe(429);
  });
});

describe('#14 invalid limits fail fast', () => {
  it('the resolver rejects a non-positive limit, naming the rule', () => {
    const build = (): ConfigurablePolicyResolver =>
      new ConfigurablePolicyResolver({
        ...RULES,
        resources: { search: { limit: 0, windowMs: WINDOW_MS } },
      });

    expect(build).toThrow(InvalidArgumentError);
    expect(build).toThrow(/resources\.search\.limit/);
  });
});
