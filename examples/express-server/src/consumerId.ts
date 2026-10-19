import type { Request } from 'express';

// 1–64 characters from a safe charset. A duplicated header arrives joined with ", " and so fails too.
const CONSUMER_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Returns the validated `X-Consumer-Id` (untrusted input), or `undefined` when it is missing or invalid. */
export function consumerIdFrom(req: Pick<Request, 'headers'>): string | undefined {
  const value = req.headers['x-consumer-id'];
  return typeof value === 'string' && CONSUMER_ID.test(value) ? value : undefined;
}
