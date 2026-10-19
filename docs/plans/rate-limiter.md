# Rate Limiter — Task Plan

Design: [`docs/design/rate-limiter.md`](../design/rate-limiter.md).

Prerequisite: the tooling PRs (`chore/project-scaffold` → `chore/barrels-alias-treeshaking` → `chore/import-order`)
are merged into `main`. Until they are, branch task 1 from `chore/import-order` (stacked PR).

| #   | Task                                                              | Branch                         | Depends on | Status |
| --- | ----------------------------------------------------------------- | ------------------------------ | ---------- | ------ |
| 1   | Design note + task plan                                           | docs/rate-limiter-design       | —          | done   |
| 2   | Domain types, ports, `SystemClock`, `FakeClock`                   | feat/rate-limiter-core-types   | 1          | done   |
| 3   | `RATE_LIMIT_*` env variables                                      | feat/rate-limiter-env          | 1          | done   |
| 4   | `AppError`, `RateLimitError`, `RateLimitTimeoutError`             | feat/rate-limiter-errors       | 1          | done   |
| 5   | `InMemoryStore` + tests                                           | feat/rate-limiter-memory-store | 2          | done   |
| 6   | `ConfigurablePolicyResolver` + tests                              | feat/rate-limiter-policies     | 2          | done   |
| 7   | `RateLimiter` + tests                                             | feat/rate-limiter-limiter      | 2          | done   |
| 8   | `toRateLimitHeaders` + tests                                      | feat/rate-limiter-headers      | 2          | done   |
| 9   | `SlidingWindowLogStrategy` + tests                                | feat/rate-limiter-sliding-log  | 5          | done   |
| 10  | `acquire` + tests                                                 | feat/rate-limiter-acquire      | 4, 7       | done   |
| 11  | `withRateLimit` + tests                                           | feat/rate-limiter-with-limit   | 10         | done   |
| 12  | `createRateLimiter` factory + default `rateLimit()` + public API  | feat/rate-limiter-wiring       | 3, 6, 7, 9 | done   |
| 13  | README: usage, headers, algorithm choice, HA design (extension b) | docs/rate-limiter-readme       | 8, 11, 12  | done   |
| 14  | Validate policies in `ConfigurablePolicyResolver`                 | feat/rate-limiter-policy-check | 6, 10      | done   |

Execution order:

```
1 → (2 ∥ 3 ∥ 4)
2 → (5 ∥ 6 ∥ 7 ∥ 8)
5 → 9
(4, 7) → 10 → 11
(3, 6, 7, 9) → 12
(8, 11, 12) → 13
(6, 10) → 14
```

## Non-functional requirements

| NFR             | Criterion (verifiable)                                                                                                                   | Task(s) | Status                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Scalability     | Memory is O(limit) per active key, and each check is O(limit). Idle keys are evicted by the sweep (tested via `size`).                   | 5, 9    | done                                                                             |
| Scalability     | Multi-instance deployments: a shared `RedisStore` behind the same `RateLimitStore` interface, with no API change (API is already async). | 13      | deferred: extension (b) is design-only; see README "Known limitations"           |
| Maintainability | A new algorithm, policy source or store is a new class. `RateLimiter` is unchanged (tests use fake strategy/resolver/store).             | 6, 7, 9 | done                                                                             |
| Maintainability | `createRateLimiter` is the only place that picks concrete classes.                                                                       | 12      | done                                                                             |
| Readability     | One class per file, public API matches the design note, and README examples cover every exported function.                               | 12, 13  | done                                                                             |
| Security        | Env limits are validated (positive integers) and fail fast.                                                                              | 3       | done                                                                             |
| Security        | Store keys can't collide, whatever characters the IDs contain (tested with separators and quotes).                                       | 7       | done                                                                             |
| Security        | Retrying clients can't lock themselves out (denied requests are not recorded), and `Retry-After` is rounded up.                          | 8, 9    | done                                                                             |
| Security        | `acquire` can't wait forever: `maxWaitMs`, `maxAttempts` and `signal` are honoured (tested).                                             | 10      | done                                                                             |
| Security        | A flood of unique consumer IDs within one window grows memory until the sweep. A max-keys cap is not built.                              | 13      | deferred: see README "Known limitations"; mitigate at a gateway/IP or with Redis |
| Observability   | Every result exposes `limit`, `remaining`, `resetMs` and `retryAfterMs`, and these map to standard HTTP headers.                         | 8       | done                                                                             |
| Observability   | Logs/metrics of allow/deny decisions. The hook is a Decorator over `RateLimitStrategy`, documented in the README.                        | 13      | deferred: no logger port yet; Decorator sketch in README "Known limitations"     |
| Security        | Policies built in code are validated: `limit` and `windowMs` must be positive integers, so no zero-wait retry loop.                      | 14      | done                                                                             |

## Task details

Each task follows TDD (§8.2): failing test first, Red output in the PR. Each new directory gets an `index.ts` barrel
and tree-shaking probes in `src/treeshaking.test.ts`.

### 1. Design note + task plan

- `docs/design/rate-limiter.md` (copied from the `rate-limit` repo, with an adaptations section) and this plan.
- Done when: `pnpm format:check` passes.

### 2. Domain types, ports, `SystemClock`, `FakeClock`

- `src/domain/types.ts`: `Consumer`, `LimitPolicy`, `RateLimitResult` (discriminated union), `DEFAULT_RESOURCE`.
- `src/interfaces/`: `Clock`, `RateLimitStore<TState>` + `StateTransition`, `RateLimitStrategy`, `PolicyResolver`.
- `src/domain/SystemClock.ts`: `Date.now()` behind `Clock`.
- `src/testing/FakeClock.ts`: settable/advanceable clock for tests. Not exported from `src/index.ts`.
- Tests: `SystemClock` returns the current time (`vi.useFakeTimers` + `vi.setSystemTime`), `FakeClock` advances.
- Barrels + probes for `domain/`, `interfaces/`, `testing/`.

### 3. `RATE_LIMIT_*` env variables

- Add `RATE_LIMIT_MAX_REQUESTS` (default `10`) and `RATE_LIMIT_WINDOW_MS` (default `1000`) to `EnvSchema`, both
  `z.coerce.number().int().positive()`. Update `.env.example`.
- Tests via `parseEnv({...})`: defaults, valid overrides, and rejection of `0`, negatives, non-integers and text.
- NFR (security): bad limits fail fast at startup.

### 4. `AppError`, `RateLimitError`, `RateLimitTimeoutError`

- `AppError` is the base of all domain errors (sets `name`, supports `cause`).
- `RateLimitError extends AppError`. `RateLimitTimeoutError extends RateLimitError` and carries the last denied
  `RateLimitResult`.
- Tests: `instanceof` chain, `name`, `message`, and the carried result.

### 5. `InMemoryStore` + tests

- Adapter over `Map`. Atomic `update` (no `await` between read and write), lazy expiry on read, sweep at most once per
  TTL.
- Tests with `FakeClock`: new key sees `undefined`, state carries over within TTL, expired state reads as
  `undefined`, sweep evicts idle keys (`size`), and the transition's `result` is returned.
- NFR (scalability): idle keys don't leak memory.

### 6. `ConfigurablePolicyResolver` + tests

- Precedence: `overrides[resource][consumer]` → `consumers[consumer]` → `resources[resource]` → `default`. A missing
  `resource` means `DEFAULT_RESOURCE`.
- Tests: each level wins over the ones below it, fallback to `default`, and unknown keys.

### 7. `RateLimiter` + tests

- `check(consumer)`: resolves the policy, builds the key `JSON.stringify([resource, consumerId])`, and delegates to
  the strategy.
- Tests with fake `PolicyResolver` and `RateLimitStrategy`: the `resource` default, keys that can't collide (IDs
  containing separators or quotes), and the result passed through unchanged.
- NFR (security, maintainability): keys can't collide, and the collaborators are swappable fakes.

### 8. `toRateLimitHeaders` + tests

- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds, rounded up), and `Retry-After` only when
  denied.
- Tests: allowed vs denied, rounding up (e.g. 1 ms → `1`, 1000 ms → `1`, 1001 ms → `2`), and `0` reset.

### 9. `SlidingWindowLogStrategy` + tests

- Algorithm as in the design note: drop old timestamps, allow and record if under the limit, otherwise deny with
  `oldest + windowMs - now`. Denied requests are not recorded.
- Tests (`InMemoryStore` + `FakeClock`):
  - A burst of 10 is allowed. The 11th is denied with an exact `retryAfterMs` and is allowed after that wait.
  - 5 at t=0 and 5 at t=500. Denied at t=999. Exactly 5 free at t=1000.
  - Denied requests don't use up quota. `remaining` and `resetMs` are correct.
  - Keys are isolated.
  - Invariant: with seeded random arrivals, no `windowMs` span has more than `limit` allowed requests.
- NFR (scalability, security): the log never holds more than `limit` timestamps, and denied requests are not
  recorded (both asserted).
- If the test file goes over ~300 lines with the code, split the invariant test into its own PR.

### 10. `acquire` + tests

- On deny, waits `retryAfterMs` + `random() * jitterMs` and then checks again. Throws `RateLimitTimeoutError` before
  sleeping if `maxWaitMs` or `maxAttempts` would be exceeded. `signal` aborts at once with its reason.
- Takes the limiter as `Pick<RateLimiter, 'check'>`, so tests use a fake.
- Tests (`vi.useFakeTimers`): wait then succeed, `maxWaitMs` timeout, `maxAttempts` timeout, abort before and during
  the wait, and jitter never retries early.
- NFR (security): no unbounded waiting.

### 11. `withRateLimit` + tests

- Decorator-style wrapper: `withRateLimit(limiter, consumer, fn, options?)` calls `acquire` before every call to
  `fn`.
- Tests: arguments, return value and errors pass through. A burst of 15 runs 10 immediately and 5 after the window.

### 12. `createRateLimiter` factory + default `rateLimit()` + public API

- `createRateLimiter({ defaultPolicy | policies, clock?, store? })` is the only place that picks concrete classes.
- `rateLimit(consumer)` in the composition root lazily builds one limiter from `getConfig()` on first use.
- `src/index.ts` exports the public API from the design note.
- Tests: factory defaults and overrides. The default `rateLimit` allows 10 and then denies the 11th with
  `0 < retryAfterMs <= 1000` (stub `process.loadEnvFile`, as the `getConfig` tests do).

### 13. README

- Usage, how to run the tests, API, configuration, HTTP headers, algorithm choice (fixed window vs token bucket vs
  sliding log), extension (a) example, the extension (b) HA design (Redis Lua script, `TIME`, hash tags,
  fail-open/closed, replication, local pre-check), and p-limit / retry-library notes.
- NFR: document the deferred items from the NFR table (Redis store, the unique-ID memory risk, and logging/metrics
  via a Decorator).

### 14. Validate policies in `ConfigurablePolicyResolver`

- Found while reviewing task 9: env limits are validated (task 3), but policies passed in code are not. With
  `limit: 0`, every request is denied with `retryAfterMs: 0`, so `acquire` retries with no delay and, without
  `maxAttempts`, never stops. `windowMs <= 0` also breaks the window logic.
- The `ConfigurablePolicyResolver` constructor checks every policy (`default`, `resources`, `consumers`,
  `overrides`): `limit` and `windowMs` must be positive safe integers. Otherwise it throws `InvalidArgumentError`
  (added in task 10, `extends AppError`), whose message names the bad rule (e.g. `overrides.search.acme.limit`).
- Tests: valid rules still resolve, and `0`, negatives, non-integers, `NaN` and `Infinity` are rejected at every
  level, with the rule's path in the message.
- NFR (security): no zero-wait retry loop from a bad policy.
