import type { RateLimiter } from 'coding-challenge-loic-wong';
import express, { type Express } from 'express';

import { rateLimitMiddleware } from './rateLimitMiddleware';
import { reportHandler } from './reportRoute';
import type { FetchReport } from './upstream';

/** What the app needs from its caller; only the composition root (or a test) builds these. */
export interface AppDependencies {
  readonly limiter: Pick<RateLimiter, 'check'>;
  /** Fetches a report from the upstream, already rate-limited (see `rateLimitedFetchReport`). Omitted: no `/api/report`. */
  readonly fetchReport?: FetchReport;
}

/** Builds the Express app. No `listen` and no env access: the caller decides how to run it. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/resource', rateLimitMiddleware(deps.limiter, 'resource'), (_req, res) => {
    res.json({ resource: 'resource', consumerId: res.locals.consumerId });
  });
  app.get('/api/search', rateLimitMiddleware(deps.limiter, 'search'), (_req, res) => {
    res.json({ resource: 'search', consumerId: res.locals.consumerId });
  });
  if (deps.fetchReport !== undefined) {
    app.get(
      '/api/report/:id',
      rateLimitMiddleware(deps.limiter, 'report'),
      reportHandler(deps.fetchReport),
    );
  }
  return app;
}
