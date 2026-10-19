import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimiter, SystemClock, type Consumer, type RateLimitResult } from '@/domain';
import { InvalidArgumentError, RateLimitTimeoutError } from '@/errors';
import { ConfigurablePolicyResolver } from '@/policies';
import { InMemoryStore } from '@/stores';
import { SlidingWindowLogStrategy } from '@/strategies';

import { withRateLimit } from './withRateLimit';

const consumer: Consumer = { consumerId: 'alice' };

const allowed: RateLimitResult = {
  allowed: true,
  limit: 10,
  remaining: 9,
  resetMs: 1000,
  retryAfterMs: 0,
};

const denied: RateLimitResult = {
  allowed: false,
  limit: 10,
  remaining: 0,
  resetMs: 500,
  retryAfterMs: 500,
};

/** Fake limiter: always returns the same result and records each call. */
class FixedLimiter {
  public readonly calls: Consumer[] = [];

  public constructor(private readonly result: RateLimitResult) {}

  public check(consumer: Consumer): Promise<RateLimitResult> {
    this.calls.push(consumer);
    return Promise.resolve(this.result);
  }
}

describe('withRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 }); // drives both Date.now (SystemClock) and setTimeout
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks the limiter for the consumer, then passes arguments and the result through', async () => {
    const limiter = new FixedLimiter(allowed);
    const add = withRateLimit(limiter, consumer, (a: number, b: number) => Promise.resolve(a + b));

    await expect(add(2, 3)).resolves.toBe(5);
    expect(limiter.calls).toEqual([consumer]);
  });

  it('supports a synchronous fn', async () => {
    const double = withRateLimit(new FixedLimiter(allowed), consumer, (n: number) => n * 2);

    await expect(double(21)).resolves.toBe(42);
  });

  it('checks the limiter again on every call', async () => {
    const limiter = new FixedLimiter(allowed);
    const task = withRateLimit(limiter, consumer, () => Promise.resolve('ok'));

    await task();
    await task();

    expect(limiter.calls).toHaveLength(2);
  });

  it('propagates a rejection from fn', async () => {
    const failure = new Error('boom');
    const task = withRateLimit(new FixedLimiter(allowed), consumer, () => Promise.reject(failure));

    await expect(task()).rejects.toBe(failure);
  });

  it('turns a synchronous throw from fn into a rejection', async () => {
    const failure = new Error('boom');
    const task = withRateLimit(new FixedLimiter(allowed), consumer, (): number => {
      throw failure;
    });

    await expect(task()).rejects.toBe(failure);
  });

  it('never calls fn when acquire times out', async () => {
    const fn = vi.fn(() => Promise.resolve('ok'));
    const task = withRateLimit(new FixedLimiter(denied), consumer, fn, { maxWaitMs: 100 });

    await expect(task()).rejects.toBeInstanceOf(RateLimitTimeoutError);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never calls fn when the signal aborts during the wait', async () => {
    const fn = vi.fn(() => Promise.resolve('ok'));
    const controller = new AbortController();
    const task = withRateLimit(new FixedLimiter(denied), consumer, fn, {
      signal: controller.signal,
    });

    const assertion = expect(task()).rejects.toBe('stop');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort('stop');
    await assertion;

    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never calls fn when the options are invalid', async () => {
    const fn = vi.fn(() => Promise.resolve('ok'));
    const task = withRateLimit(new FixedLimiter(allowed), consumer, fn, { maxWaitMs: -1 });

    await expect(task()).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs a burst of 15 calls (policy 10/1000 ms) as 10 now and 5 after the window', async () => {
    const clock = new SystemClock();
    const limiter = new RateLimiter(
      new ConfigurablePolicyResolver({ default: { limit: 10, windowMs: 1000 } }),
      new SlidingWindowLogStrategy(new InMemoryStore(clock), clock),
    );
    const startedAt: number[] = [];
    const task = withRateLimit(limiter, consumer, (index: number) => {
      startedAt.push(Date.now());
      return Promise.resolve(index);
    });
    const indexes = Array.from({ length: 15 }, (_, index) => index);

    const all = Promise.all(indexes.map((index) => task(index)));

    await vi.advanceTimersByTimeAsync(999);
    expect(startedAt).toEqual(Array.from({ length: 10 }, () => 0)); // the rest are not 1 ms early
    await vi.advanceTimersByTimeAsync(1);

    await expect(all).resolves.toEqual(indexes);
    expect(startedAt).toEqual([
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 5 }, () => 1000),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
