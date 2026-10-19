import type { Clock, RateLimitStore, StateTransition } from '@/interfaces';

interface Entry<TState> {
  readonly state: TState;
  readonly expiresAt: number;
}

/**
 * Adapter: `RateLimitStore` over a `Map`, for a single process.
 * Updates are atomic because read, transition and write run synchronously (no `await` in between).
 * Expired entries are ignored on read and swept at most once per TTL, so idle keys don't leak memory.
 */
export class InMemoryStore<TState> implements RateLimitStore<TState> {
  private readonly entries = new Map<string, Entry<TState>>();
  private nextSweepAt = 0;

  public constructor(private readonly clock: Clock) {}

  /** Number of stored entries, including expired ones not yet swept. */
  public get size(): number {
    return this.entries.size;
  }

  public update<TResult>(
    key: string,
    ttlMs: number,
    transition: (previous: TState | undefined) => StateTransition<TState, TResult>,
  ): Promise<TResult> {
    // The executor runs synchronously, so the update stays atomic; a throwing transition rejects.
    return new Promise((resolve) => {
      resolve(this.apply(key, ttlMs, transition));
    });
  }

  private apply<TResult>(
    key: string,
    ttlMs: number,
    transition: (previous: TState | undefined) => StateTransition<TState, TResult>,
  ): TResult {
    const now = this.clock.now();
    this.sweepIfDue(now, ttlMs);

    const entry = this.entries.get(key);
    const previous = entry !== undefined && entry.expiresAt > now ? entry.state : undefined;
    const { state, result } = transition(previous);
    this.entries.set(key, { state, expiresAt: now + ttlMs });
    return result;
  }

  private sweepIfDue(now: number, intervalMs: number): void {
    if (now < this.nextSweepAt) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    this.nextSweepAt = now + intervalMs;
  }
}
