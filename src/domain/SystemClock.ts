import type { Clock } from '@/interfaces';

/** Production `Clock`: wall-clock time from `Date.now()`. */
export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}
