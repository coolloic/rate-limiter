import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Consumer, RateLimitResult } from '@/domain';
import {
  AppError,
  InvalidArgumentError,
  RateLimitTimeoutError,
  type DeniedRateLimitResult,
} from '@/errors';

import { acquire } from './acquire';

const consumer: Consumer = { consumerId: 'alice' };

const allowed: RateLimitResult = {
  allowed: true,
  limit: 10,
  remaining: 9,
  resetMs: 1000,
  retryAfterMs: 0,
};

function denied(retryAfterMs: number): DeniedRateLimitResult {
  return { allowed: false, limit: 10, remaining: 0, resetMs: retryAfterMs, retryAfterMs };
}

/** Fake limiter: returns the scripted results in order (the last one repeats) and records each call. */
class ScriptedLimiter {
  public readonly calls: Consumer[] = [];
  public readonly callTimes: number[] = [];

  public constructor(private readonly results: readonly RateLimitResult[]) {}

  public check(consumer: Consumer): Promise<RateLimitResult> {
    this.calls.push(consumer);
    this.callTimes.push(Date.now());
    const result = this.results[Math.min(this.calls.length, this.results.length) - 1];
    if (result === undefined) throw new Error('ScriptedLimiter needs at least one result');
    return Promise.resolve(result);
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable('expected a rejection'),
    (error: unknown) => error,
  );
}

describe('acquire', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an allowed result at once, without timers', async () => {
    const limiter = new ScriptedLimiter([allowed]);

    await expect(acquire(limiter, consumer)).resolves.toBe(allowed);
    expect(limiter.calls).toEqual([consumer]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits exactly retryAfterMs, then checks again and succeeds', async () => {
    const limiter = new ScriptedLimiter([denied(600), allowed]);
    const pending = acquire(limiter, consumer);

    await vi.advanceTimersByTimeAsync(599);
    expect(limiter.calls).toHaveLength(1); // not 1 ms early
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBe(allowed);
    expect(limiter.callTimes).toEqual([0, 600]);
  });

  it('keeps waiting across several denials', async () => {
    const limiter = new ScriptedLimiter([denied(100), denied(200), allowed]);
    const pending = acquire(limiter, consumer);

    await vi.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toBe(allowed);
    expect(limiter.callTimes).toEqual([0, 100, 300]);
  });

  it('throws RateLimitTimeoutError before sleeping when the wait would exceed maxWaitMs', async () => {
    const last = denied(1000);
    const limiter = new ScriptedLimiter([last]);

    const error = await rejectionOf(acquire(limiter, consumer, { maxWaitMs: 999 }));

    expect(error).toBeInstanceOf(RateLimitTimeoutError);
    expect(error).toHaveProperty('lastResult', last);
    expect(vi.getTimerCount()).toBe(0);
    expect(Date.now()).toBe(0);
  });

  it('counts time already waited towards maxWaitMs', async () => {
    const first = denied(400);
    const second = denied(200);
    const limiter = new ScriptedLimiter([first, second, allowed]);
    const pending = rejectionOf(acquire(limiter, consumer, { maxWaitMs: 500 }));

    await vi.advanceTimersByTimeAsync(400);
    const error = await pending;

    expect(error).toBeInstanceOf(RateLimitTimeoutError);
    expect(error).toHaveProperty('lastResult', second);
    expect(limiter.calls).toHaveLength(2);
  });

  it('allows a wait that exactly reaches maxWaitMs', async () => {
    const limiter = new ScriptedLimiter([denied(500), allowed]);
    const pending = acquire(limiter, consumer, { maxWaitMs: 500 });

    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toBe(allowed);
  });

  it('throws RateLimitTimeoutError after maxAttempts checks, without sleeping again', async () => {
    const last = denied(100);
    const limiter = new ScriptedLimiter([denied(100), last]);
    const pending = rejectionOf(acquire(limiter, consumer, { maxAttempts: 2 }));

    await vi.advanceTimersByTimeAsync(100);
    const error = await pending;

    expect(error).toBeInstanceOf(RateLimitTimeoutError);
    expect(error).toHaveProperty('lastResult', last);
    expect(limiter.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the abort reason before the first check when already aborted', async () => {
    const limiter = new ScriptedLimiter([allowed]);
    const reason = new Error('caller gave up');

    await expect(acquire(limiter, consumer, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    expect(limiter.calls).toHaveLength(0);
  });

  it('rejects with the abort reason, without sleeping, when aborted during a denied check', async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const limiter = {
      check: (): Promise<RateLimitResult> => {
        controller.abort(reason);
        return Promise.resolve(denied(1000));
      },
    };

    await expect(acquire(limiter, consumer, { signal: controller.signal })).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once with the abort reason during the wait, and cleans up', async () => {
    const limiter = new ScriptedLimiter([denied(1000), allowed]);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const reason = new Error('caller gave up');
    const pending = rejectionOf(acquire(limiter, consumer, { signal: controller.signal }));

    await vi.advanceTimersByTimeAsync(100);
    controller.abort(reason);

    await expect(pending).resolves.toBe(reason);
    expect(Date.now()).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    await vi.advanceTimersByTimeAsync(1000);
    expect(limiter.calls).toHaveLength(1);
  });

  it('removes the abort listener when the wait completes normally', async () => {
    const limiter = new ScriptedLimiter([denied(100), allowed]);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = acquire(limiter, consumer, { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toBe(allowed);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('adds random() * jitterMs on top of retryAfterMs and never retries early', async () => {
    const limiter = new ScriptedLimiter([denied(1000), allowed]);
    const pending = acquire(limiter, consumer, { jitterMs: 100, random: () => 0.5 });

    await vi.advanceTimersByTimeAsync(1049);
    expect(limiter.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBe(allowed);
    expect(limiter.callTimes).toEqual([0, 1050]);
  });

  it('waits exactly retryAfterMs when random() returns 0', async () => {
    const limiter = new ScriptedLimiter([denied(1000), allowed]);
    const pending = acquire(limiter, consumer, { jitterMs: 100, random: () => 0 });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe(allowed);
    expect(limiter.callTimes).toEqual([0, 1000]);
  });

  it('includes jitter when checking maxWaitMs', async () => {
    const limiter = new ScriptedLimiter([denied(1000)]);

    const error = await rejectionOf(
      acquire(limiter, consumer, { maxWaitMs: 1049, jitterMs: 100, random: () => 0.5 }),
    );

    expect(error).toBeInstanceOf(RateLimitTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('option validation', () => {
    it.each([
      ['maxWaitMs', { maxWaitMs: -1 }],
      ['maxWaitMs', { maxWaitMs: Number.NaN }],
      ['maxAttempts', { maxAttempts: 0 }],
      ['maxAttempts', { maxAttempts: 1.5 }],
      ['maxAttempts', { maxAttempts: Number.NaN }],
      ['jitterMs', { jitterMs: -1 }],
      ['jitterMs', { jitterMs: Number.NaN }],
      ['jitterMs', { jitterMs: Number.POSITIVE_INFINITY }],
    ])(
      'rejects an invalid %s (%o) with an InvalidArgumentError, before any check',
      async (name, options) => {
        const limiter = new ScriptedLimiter([allowed]);

        const error = await rejectionOf(acquire(limiter, consumer, options));

        expect(error).toBeInstanceOf(InvalidArgumentError);
        expect(error).toBeInstanceOf(AppError);
        expect(error).toHaveProperty('message', expect.stringContaining(name));
        expect(limiter.calls).toHaveLength(0);
      },
    );

    it('accepts boundary values: 0 wait, 1 attempt, 0 jitter, unlimited caps', async () => {
      const limiter = new ScriptedLimiter([allowed]);

      await expect(
        acquire(limiter, consumer, { maxWaitMs: 0, maxAttempts: 1, jitterMs: 0 }),
      ).resolves.toBe(allowed);
      await expect(
        acquire(limiter, consumer, {
          maxWaitMs: Number.POSITIVE_INFINITY,
          maxAttempts: Number.POSITIVE_INFINITY,
        }),
      ).resolves.toBe(allowed);
    });
  });
});
