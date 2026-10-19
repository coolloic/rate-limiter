/** What a store transition returns: the new state to keep and the result to hand back. */
export interface StateTransition<TState, TResult> {
  readonly state: TState;
  readonly result: TResult;
}

/** Adapter port: per-key state storage with atomic read-modify-write and TTL. */
export interface RateLimitStore<TState> {
  /**
   * Atomically replaces the state for `key` with the state returned by `transition`, and resolves to its `result`.
   * `previous` is `undefined` when the key is new or expired. The entry expires `ttlMs` after this write.
   * Implementations MUST guarantee that no other update of the same key interleaves.
   */
  update<TResult>(
    key: string,
    ttlMs: number,
    transition: (previous: TState | undefined) => StateTransition<TState, TResult>,
  ): Promise<TResult>;
}
