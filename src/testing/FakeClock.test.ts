import { describe, expect, it } from 'vitest';

import { FakeClock } from './FakeClock';

describe('FakeClock', () => {
  it('starts at 0 by default', () => {
    expect(new FakeClock().now()).toBe(0);
  });

  it('starts at the given time', () => {
    expect(new FakeClock(5_000).now()).toBe(5_000);
  });

  it('stays still until told to move', () => {
    const clock = new FakeClock(10);
    expect(clock.now()).toBe(10);
    expect(clock.now()).toBe(10);
  });

  it('advances by the given number of milliseconds', () => {
    const clock = new FakeClock(1_000);
    clock.advance(250);
    clock.advance(750);
    expect(clock.now()).toBe(2_000);
  });

  it('jumps to the time it is set to', () => {
    const clock = new FakeClock(1_000);
    clock.set(42);
    expect(clock.now()).toBe(42);
  });
});
