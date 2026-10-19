import {
  toRateLimitHeaders,
  type Consumer,
  type RateLimiter,
  type RateLimitResult,
} from 'coding-challenge-loic-wong';
import type { NextFunction, Request, Response } from 'express';

import { consumerIdFrom } from './consumerId';

/** What the middleware hands to the routes after it: the validated consumer ID. */
export interface ConsumerLocals {
  consumerId: string;
}

export type RateLimitHandler = (
  req: Request,
  res: Response<unknown, ConsumerLocals>,
  next: NextFunction,
) => void;

/**
 * Chain of Responsibility step: validates `X-Consumer-Id` (`400`, no quota used), checks the limiter, sets the
 * `RateLimit-*` headers, and stops the chain with `429` when denied or `503` when the limiter fails (fail closed).
 * Only an allowed request reaches the next handler.
 */
export function rateLimitMiddleware(
  limiter: Pick<RateLimiter, 'check'>,
  resource?: string,
): RateLimitHandler {
  return (req, res, next) => {
    const consumerId = consumerIdFrom(req);
    if (consumerId === undefined) {
      res.status(400).json({ error: 'Missing or invalid X-Consumer-Id header' });
      return;
    }
    const consumer: Consumer = resource === undefined ? { consumerId } : { consumerId, resource };
    void check(limiter, consumer)
      .then((result) => {
        if (result === undefined) {
          res.status(503).json({ error: 'Rate limiter unavailable' });
          return;
        }
        res.set(toRateLimitHeaders(result));
        if (!result.allowed) {
          res.status(429).json({ error: 'Too Many Requests', retryAfterMs: result.retryAfterMs });
          return;
        }
        res.locals.consumerId = consumerId;
        next();
      })
      // Limiter errors are already a 503; anything thrown while responding goes to Express's error handler.
      .catch(next);
  };
}

// Resolves to `undefined` when the limiter fails, whether `check` rejects or throws synchronously.
async function check(
  limiter: Pick<RateLimiter, 'check'>,
  consumer: Consumer,
): Promise<RateLimitResult | undefined> {
  try {
    return await limiter.check(consumer);
  } catch {
    return undefined;
  }
}
