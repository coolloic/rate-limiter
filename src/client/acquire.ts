import type { Consumer, RateLimiter, RateLimitResult } from '@/domain';
import { InvalidArgumentError, RateLimitTimeoutError } from '@/errors';

export interface AcquireOptions {
  /** Give up (without sleeping) if the total wait would exceed this. `>= 0`. Default: no limit. */
  readonly maxWaitMs?: number;
  /** Give up after this many checks. Integer `>= 1`. Default: no limit. */
  readonly maxAttempts?: number;
  /** Adds a random `0..jitterMs` delay on top of the exact wait, to spread out waiters. Default: 0. */
  readonly jitterMs?: number;
  /** Aborting rejects at once with `signal.reason`. */
  readonly signal?: AbortSignal;
  /** Returns a number in `[0, 1)`. Injectable for deterministic tests. Default: `Math.random`. */
  readonly random?: () => number;
}

/**
 * Waits for a slot instead of failing: on deny, sleeps `retryAfterMs` (plus optional jitter) and checks again.
 * Rejects with `RateLimitTimeoutError` when a cap would be exceeded, with the signal's reason on abort,
 * and with an `InvalidArgumentError` for invalid options.
 */
export async function acquire(
  limiter: Pick<RateLimiter, 'check'>,
  consumer: Consumer,
  options: AcquireOptions = {},
): Promise<RateLimitResult> {
  const {
    maxWaitMs = Number.POSITIVE_INFINITY,
    maxAttempts = Number.POSITIVE_INFINITY,
    jitterMs = 0,
    signal,
    random = Math.random,
  } = options;
  validateOptions(maxWaitMs, maxAttempts, jitterMs);
  let waitedMs = 0;

  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    const result = await limiter.check(consumer);
    if (result.allowed) return result;

    const delayMs = result.retryAfterMs + random() * jitterMs;
    if (attempt >= maxAttempts || waitedMs + delayMs > maxWaitMs) {
      throw new RateLimitTimeoutError(result);
    }

    await sleep(delayMs, signal);
    waitedMs += delayMs;
  }
}

// Invalid caps would mean waiting forever (NaN never compares true) or retrying before a slot frees up.
function validateOptions(maxWaitMs: number, maxAttempts: number, jitterMs: number): void {
  if (!(maxWaitMs >= 0)) {
    throw new InvalidArgumentError(`maxWaitMs must be >= 0, got ${String(maxWaitMs)}`);
  }
  if (!(
    maxAttempts === Number.POSITIVE_INFINITY ||
    (Number.isInteger(maxAttempts) && maxAttempts >= 1)
  )) {
    throw new InvalidArgumentError(
      `maxAttempts must be an integer >= 1, got ${String(maxAttempts)}`,
    );
  }
  if (!(Number.isFinite(jitterMs) && jitterMs >= 0)) {
    throw new InvalidArgumentError(
      `jitterMs must be a finite number >= 0, got ${String(jitterMs)}`,
    );
  }
}

/** Resolves after `ms`; on abort, clears the timer and rejects at once with the signal's reason. */
async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
  signal?.throwIfAborted();
}
