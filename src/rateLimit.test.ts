import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getConfig as GetConfig } from '@/config';

import type { rateLimit as RateLimit } from './rateLimit';

// Fresh modules per test: neither the limiter nor the config singleton may leak between tests.
async function loadModules(): Promise<{
  rateLimit: typeof RateLimit;
  getConfig: typeof GetConfig;
}> {
  vi.resetModules();
  const [{ rateLimit }, { getConfig }] = await Promise.all([
    import('./rateLimit'),
    import('@/config'),
  ]);
  return { rateLimit, getConfig };
}

describe('rateLimit (default instance)', () => {
  // Never read a developer-local .env file in tests.
  const loadEnvFile = vi.spyOn(process, 'loadEnvFile');

  beforeEach(() => {
    loadEnvFile.mockImplementation(() => undefined);
    // Freezes Date.now(), which SystemClock reads, so the window maths is deterministic.
    vi.useFakeTimers();
  });

  afterEach(() => {
    loadEnvFile.mockReset();
    vi.useRealTimers();
  });

  afterAll(() => {
    loadEnvFile.mockRestore();
  });

  it('does not read the config when the module is imported', async () => {
    await loadModules();
    expect(loadEnvFile).not.toHaveBeenCalled();
  });

  it('allows the configured number of requests, then denies with a wait within the window', async () => {
    const { rateLimit, getConfig } = await loadModules();
    const { RATE_LIMIT_MAX_REQUESTS: limit, RATE_LIMIT_WINDOW_MS: windowMs } = getConfig();
    const consumer = { consumerId: 'default-instance-test' };

    for (let i = 0; i < limit; i++) {
      expect(await rateLimit(consumer)).toMatchObject({ allowed: true, limit });
    }
    const denied = await rateLimit(consumer);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(windowMs);

    vi.advanceTimersByTime(denied.retryAfterMs);
    expect((await rateLimit(consumer)).allowed).toBe(true);
  });

  it('builds the limiter once, on first use, from getConfig()', async () => {
    const { rateLimit } = await loadModules();
    const first = await rateLimit({ consumerId: 'alice' });
    const second = await rateLimit({ consumerId: 'alice' });

    // A shared limiter means the second call sees the first call's request.
    expect(second.remaining).toBe(Math.max(first.remaining - 1, 0));
    expect(second.allowed).toBe(first.remaining > 0);
    expect(loadEnvFile).toHaveBeenCalledTimes(1);
  });
});
