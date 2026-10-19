import { describe, expect, it } from 'vitest';

import * as api from './index';

describe('public API', () => {
  // The functions listed under "Public API" in docs/design/rate-limiter.md.
  it.each(['rateLimit', 'createRateLimiter', 'toRateLimitHeaders', 'acquire', 'withRateLimit'])(
    'exports %s from the package root',
    (name) => {
      expect(api).toHaveProperty(name, expect.any(Function));
    },
  );
});
