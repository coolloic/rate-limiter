import { once } from 'node:events';

import {
  ConfigurablePolicyResolver,
  createRateLimiter,
  SystemClock,
} from 'coding-challenge-loic-wong';

import { createApp } from './app';
import { loadExampleConfig } from './config';
import { FakeUpstreamClient } from './FakeUpstreamClient';
import { rateLimitedFetchReport } from './upstream';

/** Composition root: load config (fail fast), build the limiter and the app, listen, and stop cleanly on a signal. */
async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const config = loadExampleConfig(process.env);

  // Throws InvalidArgumentError (naming the rule) on a bad policy; the catch below exits 1.
  const policies = new ConfigurablePolicyResolver({
    default: { limit: config.RATE_LIMIT_MAX_REQUESTS, windowMs: config.RATE_LIMIT_WINDOW_MS },
    ...config.RATE_LIMIT_POLICIES,
  });
  const limiter = createRateLimiter({ policies });
  const upstreamLimiter = createRateLimiter({
    defaultPolicy: {
      limit: config.UPSTREAM_RATE_LIMIT_MAX_REQUESTS,
      windowMs: config.UPSTREAM_RATE_LIMIT_WINDOW_MS,
    },
  });
  const fetchReport = rateLimitedFetchReport(
    new FakeUpstreamClient(new SystemClock()),
    upstreamLimiter,
    config.UPSTREAM_MAX_WAIT_MS,
  );
  const server = createApp({ limiter, fetchReport }).listen(config.PORT);
  await once(server, 'listening'); // rejects on 'error', e.g. EADDRINUSE

  const address = server.address();
  // A TCP server's address is an object; it is a string only for pipes/sockets.
  const port = address !== null && typeof address !== 'string' ? address.port : config.PORT;
  console.log(`Listening on http://localhost:${String(port)}`);

  const shutdown = (): void => {
    server.close((error) => {
      if (error !== undefined) console.error(error.message);
      process.exit(error === undefined ? 0 : 1);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// Node's built-in loader (no dotenv); it never overrides variables that are already set.
function loadDotEnvIfPresent(): void {
  try {
    process.loadEnvFile();
  } catch (error: unknown) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!missing) throw error;
  }
}

// This file is the executable entry point, not a library module: this call is its only top-level work.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
