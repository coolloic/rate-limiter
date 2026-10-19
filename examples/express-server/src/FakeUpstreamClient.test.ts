import type { Clock } from 'coding-challenge-loic-wong';
import { describe, expect, it } from 'vitest';

import { FakeUpstreamClient } from './FakeUpstreamClient';

// A clock that returns the given times in order.
function clockAt(...times: number[]): Clock {
  let index = 0;
  return { now: () => times[index++] ?? Number.NaN };
}

describe('FakeUpstreamClient', () => {
  it('returns a deterministic report for the id', async () => {
    const upstream = new FakeUpstreamClient(clockAt(0));

    expect(await upstream.fetchReport('r1')).toEqual({ id: 'r1', title: 'Report r1' });
  });

  it('records the time of every call, oldest first', async () => {
    const upstream = new FakeUpstreamClient(clockAt(100, 250, 250));

    await upstream.fetchReport('a');
    await upstream.fetchReport('b');
    await upstream.fetchReport('a');

    expect(upstream.callTimes()).toEqual([100, 250, 250]);
  });

  it('has no calls recorded before the first call', () => {
    expect(new FakeUpstreamClient(clockAt()).callTimes()).toEqual([]);
  });

  it('records the call before awaiting the injected delay, and resolves only after it', async () => {
    let release = (): void => undefined;
    const delay = (): Promise<void> =>
      new Promise((resolve) => {
        release = resolve;
      });
    const upstream = new FakeUpstreamClient(clockAt(7), delay);
    let settled = false;

    const pending = upstream.fetchReport('r1').then((report) => {
      settled = true;
      return report;
    });
    await Promise.resolve();

    expect(upstream.callTimes()).toEqual([7]);
    expect(settled).toBe(false);
    release();
    expect(await pending).toEqual({ id: 'r1', title: 'Report r1' });
  });

  it('returns a copy of the call times', async () => {
    const upstream = new FakeUpstreamClient(clockAt(1, 2));
    await upstream.fetchReport('a');
    const before = upstream.callTimes();

    await upstream.fetchReport('b');

    expect(before).toEqual([1]);
  });
});
