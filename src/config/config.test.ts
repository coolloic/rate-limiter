import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getConfig as GetConfig } from './config';

// Fresh module per test: the memoized singleton must not leak between tests.
async function loadGetConfig(): Promise<typeof GetConfig> {
  vi.resetModules();
  return (await import('./config')).getConfig;
}

describe('getConfig', () => {
  // Never read a developer-local .env file in tests.
  const loadEnvFile = vi.spyOn(process, 'loadEnvFile');

  beforeEach(() => {
    loadEnvFile.mockImplementation(() => undefined);
    // Pin the schema's variables so the developer's or CI's shell cannot change the outcome.
    // vi.stubEnv is auto-restored; never assign to process.env directly.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'warn');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '5');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '2000');
  });

  afterEach(() => {
    loadEnvFile.mockReset();
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    loadEnvFile.mockRestore();
  });

  it('returns a frozen, validated config', async () => {
    const config = (await loadGetConfig())();
    expect(Object.isFrozen(config)).toBe(true);
    expect(config).toEqual({
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      RATE_LIMIT_MAX_REQUESTS: 5,
      RATE_LIMIT_WINDOW_MS: 2000,
    });
  });

  it('returns the same instance and loads .env only once', async () => {
    const getConfig = await loadGetConfig();
    expect(getConfig()).toBe(getConfig());
    expect(loadEnvFile).toHaveBeenCalledTimes(1);
  });

  it('works without a .env file', async () => {
    loadEnvFile.mockImplementation(() => {
      throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    });
    await expect(loadGetConfig().then((getConfig) => getConfig())).resolves.toBeDefined();
  });

  it('rethrows other .env read errors', async () => {
    loadEnvFile.mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });
    const getConfig = await loadGetConfig();
    expect(() => getConfig()).toThrow(/permission denied/);
  });
});
