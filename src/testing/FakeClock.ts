import type { Clock } from '@/interfaces';

/** Test `Clock` that only moves when told to, for deterministic tests. */
export class FakeClock implements Clock {
  private current: number;

  public constructor(start = 0) {
    this.current = start;
  }

  public now(): number {
    return this.current;
  }

  public set(ms: number): void {
    this.current = ms;
  }

  public advance(ms: number): void {
    this.current += ms;
  }
}
