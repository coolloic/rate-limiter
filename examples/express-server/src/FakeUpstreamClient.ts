import type { Clock } from 'coding-challenge-loic-wong';

import type { Report, UpstreamClient } from './upstream';

/** In-process stand-in for an upstream service: deterministic reports, records the time of every call. No network. */
export class FakeUpstreamClient implements UpstreamClient {
  private readonly calls: number[] = [];

  /** `delay` simulates upstream latency; it is awaited after the call is recorded. */
  public constructor(
    private readonly clock: Clock,
    private readonly delay: () => Promise<void> = () => Promise.resolve(),
  ) {}

  /** When each call started (`clock.now()`), oldest first. */
  public callTimes(): readonly number[] {
    return [...this.calls];
  }

  public async fetchReport(id: string): Promise<Report> {
    this.calls.push(this.clock.now());
    await this.delay();
    return { id, title: `Report ${id}` };
  }
}
