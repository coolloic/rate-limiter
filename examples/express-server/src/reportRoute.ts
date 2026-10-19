import { RateLimitTimeoutError } from 'coding-challenge-loic-wong';
import type { NextFunction, Request, Response } from 'express';

import type { FetchReport } from './upstream';

// 1–64 characters from a safe charset (the id is untrusted input passed on to the upstream).
const REPORT_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * `GET /api/report/:id` handler; runs after `rateLimitMiddleware`. Validates the id (`400`), then fetches the report
 * through the rate-limited upstream: `200` with the report, `503` + `Retry-After` when the upstream wait would exceed
 * its cap (`RateLimitTimeoutError`), `502` for any other upstream failure (its details are not sent to the client).
 */
export function reportHandler(
  fetchReport: FetchReport,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !REPORT_ID.test(id)) {
      res.status(400).json({ error: 'Invalid report id' });
      return;
    }
    void fetchReport(id)
      .then(
        (report) => {
          res.json(report);
        },
        (error: unknown) => {
          if (error instanceof RateLimitTimeoutError) {
            const { retryAfterMs } = error.lastResult;
            res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
            res.status(503).json({ error: 'Upstream rate limit exceeded', retryAfterMs });
            return;
          }
          res.status(502).json({ error: 'Upstream request failed' });
        },
      )
      // Anything thrown while responding goes to Express's error handler.
      .catch(next);
  };
}
