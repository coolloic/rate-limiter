import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemClock } from './SystemClock';

describe('SystemClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current system time in milliseconds', () => {
    vi.setSystemTime(1_700_000_000_000);
    expect(new SystemClock().now()).toBe(1_700_000_000_000);
  });

  it('follows the system time as it moves', () => {
    const clock = new SystemClock();
    vi.setSystemTime(1_000);
    vi.advanceTimersByTime(250);
    expect(clock.now()).toBe(1_250);
  });
});
