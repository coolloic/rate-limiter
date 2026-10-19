/** Source of the current time, injected so tests can control it. */
export interface Clock {
  /** Current time in milliseconds. */
  now(): number;
}
