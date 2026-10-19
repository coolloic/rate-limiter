# Rate limiter

A small TypeScript rate-limiting library. `rateLimit(consumer)` tells you whether an identified consumer may proceed,
and if not, exactly how many milliseconds it must wait. By default a consumer gets **at most 10 requests in any
1-second span**.

```ts
import { rateLimit } from './src';

const result = await rateLimit({ consumerId: 'user-42' });

if (result.allowed) {
  // Proceed. result.remaining says how much quota is left.
} else {
  console.log(`Try again in ${String(result.retryAfterMs)} ms`);
}
```

The package is private and not published, so the examples import from the repo entry point (`./src`, which is
`src/index.ts`). Imports are extensionless.

**Express example:** [`examples/express-server/`](./examples/express-server/README.md) is an Express server that uses
the library through its package exports, with E2E tests over real HTTP. Run it with `pnpm example:start`, or watch
every scenario play out with `pnpm example:demo`.

**Presentation:** a 16-slide walkthrough of the design and solution, as
[PDF](./docs/presentation/rate-limiter.pdf) or [HTML](./docs/presentation/rate-limiter.html). GitHub previews the PDF;
open the HTML in a browser for the slide view (arrow keys to navigate).

## Requirements and running the tests

Requirements: **Node 24** (pinned in `.nvmrc`) and **pnpm** (pinned in `package.json`).

```bash
nvm use            # switch to Node 24 from .nvmrc
pnpm install       # also installs the Git hooks
pnpm test          # run the test suite (Vitest)
pnpm check         # format check + typecheck + lint + tests
pnpm build         # bundle src/index.ts with esbuild into dist/index.js
```

The tests use fake clocks and fake timers, so they are deterministic and fast. The main test files:

| Test file                                         | What it demonstrates                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/strategies/SlidingWindowLogStrategy.test.ts` | 10 allowed, then the 11th is denied with the exact wait. Quota frees up as requests age out. Denied requests don't use up quota. Keys are isolated. **Randomised invariant**: across 2,000 seeded random arrivals, no 1-second span has more than 10 allowed requests |
| `src/rateLimit.test.ts`                           | The default `rateLimit`: the configured limit (10 by default) is allowed, then the next request is denied with a wait within the window. The limiter is built lazily from `getConfig()`                                                                               |
| `src/factories/createRateLimiter.test.ts`         | The factory wires a working limiter from `defaultPolicy` or `policies`, plus an injected clock and store                                                                                                                                                              |
| `src/policies/ConfigurablePolicyResolver.test.ts` | Per-resource and per-consumer limits, which rule wins, and rejection of invalid policies                                                                                                                                                                              |
| `src/domain/RateLimiter.test.ts`                  | Store keys can't collide, whatever characters the IDs contain                                                                                                                                                                                                         |
| `src/http/headers.test.ts`                        | IETF `RateLimit-*` headers, rounding up, and `Retry-After` only on deny                                                                                                                                                                                               |
| `src/client/acquire.test.ts`                      | Waiting for a slot, `maxWaitMs` / `maxAttempts` timeouts, abort, jitter, and option validation                                                                                                                                                                        |
| `src/client/withRateLimit.test.ts`                | The wrapper passes arguments, results and errors through. A burst of 15 runs 10 at once and 5 after the window                                                                                                                                                        |
| `src/stores/InMemoryStore.test.ts`                | TTL expiry, and the sweep that evicts idle keys                                                                                                                                                                                                                       |

## API

```ts
interface Consumer {
  readonly consumerId: string;
  readonly resource?: string; // defaults to DEFAULT_RESOURCE ("default")
}

interface LimitPolicy {
  readonly limit: number; // at most `limit` requests ...
  readonly windowMs: number; // ... in any `windowMs` span
}

type RateLimitResult =
  | { allowed: true; limit: number; remaining: number; resetMs: number; retryAfterMs: 0 }
  | { allowed: false; limit: number; remaining: 0; resetMs: number; retryAfterMs: number };
```

`resetMs` is the time until at least one quota unit frees up. `retryAfterMs` is how long to wait before retrying (`0`
when allowed). All fields are `readonly`.

| Function                                                           | Returns                            | Purpose                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `rateLimit(consumer)`                                              | `Promise<RateLimitResult>`         | Check against the default limiter, built on first use from env config (10 per 1000 ms)                               |
| `createRateLimiter({ defaultPolicy \| policies, clock?, store? })` | `RateLimiter`                      | Build your own limiter. Pass **exactly one** of `defaultPolicy` (a `LimitPolicy`) or `policies` (a `PolicyResolver`) |
| `limiter.check(consumer)`                                          | `Promise<RateLimitResult>`         | Check against that limiter                                                                                           |
| `toRateLimitHeaders(result)`                                       | `Readonly<Record<string, string>>` | HTTP response headers for a result                                                                                   |
| `acquire(limiter, consumer, options?)`                             | `Promise<RateLimitResult>`         | Wait for a slot instead of being denied                                                                              |
| `withRateLimit(limiter, consumer, fn, options?)`                   | `(...args) => Promise<TResult>`    | Wrap a sync or async function so every call first waits for a slot                                                   |
| `getConfig()`                                                      | `Readonly<Env>`                    | The validated env config (lazy singleton)                                                                            |

`createRateLimiter` throws `InvalidArgumentError` if `defaultPolicy` is not a pair of positive integers. Its `clock`
defaults to `SystemClock` and its `store` to a new in-process `InMemoryStore`. It never reads config.

`AcquireOptions` (all optional):

| Option        | Default       | Meaning                                                                        |
| ------------- | ------------- | ------------------------------------------------------------------------------ |
| `maxWaitMs`   | no limit      | Give up, without sleeping, if the total wait would exceed this. Must be `>= 0` |
| `maxAttempts` | no limit      | Give up after this many checks. Integer `>= 1`                                 |
| `jitterMs`    | `0`           | Add a random `0..jitterMs` on top of the exact wait. Finite, `>= 0`            |
| `signal`      | none          | `AbortSignal`. Aborting rejects at once with `signal.reason`                   |
| `random`      | `Math.random` | Returns a number in `[0, 1)`. Injectable for deterministic tests               |

`acquire` (and so the function returned by `withRateLimit`) rejects with `RateLimitTimeoutError` when a cap would be
exceeded, with `signal.reason` on abort, and with `InvalidArgumentError` for invalid options. If it rejects, the
wrapped `fn` is not called.

Other exports, in brief:

| Export                                                                                     | Kind           | Purpose                                                                           |
| ------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `RateLimiter`                                                                              | class          | Resolves the policy, builds the store key, and delegates to a `RateLimitStrategy` |
| `SlidingWindowLogStrategy`, `SlidingWindowLog`                                             | class, type    | The algorithm (Strategy) and its per-key state                                    |
| `InMemoryStore`                                                                            | class          | `Map`-backed `RateLimitStore` for one process (Adapter)                           |
| `ConfigurablePolicyResolver`, `PolicyRules`                                                | class, type    | Per-resource / per-consumer limits (see extension (a))                            |
| `SystemClock`                                                                              | class          | `Clock` backed by `Date.now()`                                                    |
| `Clock`, `PolicyResolver`, `RateLimitStore`, `RateLimitStrategy`, `StateTransition`        | types          | The ports, for your own implementations                                           |
| `AppError`                                                                                 | abstract class | Base of every domain error                                                        |
| `InvalidArgumentError`                                                                     | class          | Invalid policy or `acquire` option                                                |
| `RateLimitError`, `RateLimitTimeoutError`                                                  | classes        | Rate-limit errors. `RateLimitTimeoutError.lastResult` is the last denied result   |
| `DEFAULT_RESOURCE`, `DeniedRateLimitResult`, `AcquireOptions`, `RateLimiterOptions`, `Env` | const, types   | Supporting constant and types                                                     |

## Configuration

The default limiter behind `rateLimit()` is configured with environment variables. `getConfig()` loads `.env` with
Node's `process.loadEnvFile()` (variables already set in the environment win) and validates everything with Zod. Every
variable is documented in [`.env.example`](./.env.example).

| Variable                  | Default       | Validation                                                                                                                             |
| ------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_MAX_REQUESTS` | `10`          | Positive integer (requests per window)                                                                                                 |
| `RATE_LIMIT_WINDOW_MS`    | `1000`        | Positive integer (window length in ms)                                                                                                 |
| `NODE_ENV`                | `development` | `development`, `test` or `production`                                                                                                  |
| `LOG_LEVEL`               | `info`        | `debug`, `info`, `warn` or `error`. Not used yet: there is no logging (see [Known limitations](#known-limitations-and-deferred-items)) |

Empty values (`RATE_LIMIT_WINDOW_MS=`) count as unset, so the default applies. Invalid values **fail fast**: the first
`getConfig()` call throws one error that lists every bad field. Config is read lazily, on the first `rateLimit()` call,
so an application should call `getConfig()` at startup to fail before serving traffic. Limiters built with
`createRateLimiter` don't use env config at all.

## HTTP headers

`toRateLimitHeaders(result)` follows the IETF RateLimit header fields draft, plus `Retry-After` from RFC 9110:

| Header                | Value                                                                   | Example                  |
| --------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `RateLimit-Limit`     | The request quota per window                                            | `RateLimit-Limit: 10`    |
| `RateLimit-Remaining` | Quota units left                                                        | `RateLimit-Remaining: 4` |
| `RateLimit-Reset`     | **Relative** seconds until a quota unit frees up (not a Unix timestamp) | `RateLimit-Reset: 1`     |
| `Retry-After`         | **Only on deny.** Seconds to wait before retrying                       | `Retry-After: 1`         |

- Seconds are **rounded up** (1 ms → `1`, 1000 ms → `1`, 1001 ms → `2`), so a client that obeys the header never
  comes back too early.
- The request that uses the last unit is **allowed with `remaining: 0`**. It gets `RateLimit-Remaining: 0` but no
  `Retry-After`, because it was not denied. The next request before a unit frees up is denied (429).
- `Retry-After` is included because many existing clients already respect it: Python `urllib3.Retry`, many SDKs, and
  browsers.

A middleware example (Express-style):

```ts
import { rateLimit, toRateLimitHeaders } from './src';

app.use(async (req, res, next) => {
  const result = await rateLimit({ consumerId: req.user.id });
  res.set(toRateLimitHeaders(result));
  if (!result.allowed) {
    res.status(429).send('Too Many Requests');
    return;
  }
  next();
});
```

> Newer revisions of the draft merge these fields into structured `RateLimit` / `RateLimit-Policy` headers. Only the
> mapping would change, which is a small edit in `src/http/headers.ts`.

## Algorithm choice

The requirement is "**not more than 10 requests per second** for any consumer". The three common algorithms handle
that differently:

| Algorithm                 | How it works                                                                            | Holds "≤ 10 in any second"?                                                | Memory per consumer          | Wait time                          |
| ------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| **Fixed window**          | A counter that resets every whole second                                                | No: 10 at t=0.99 s plus 10 at t=1.01 s gives **20 in 20 ms**               | O(1)                         | Coarse (until the window boundary) |
| **Token bucket**          | A bucket of 10 tokens refilled at 10/s                                                  | No: a full bucket plus the refill allows **up to ~19 in a rolling second** | O(1)                         | Exact for the next token           |
| **Sliding window log** ✅ | Keep the timestamps of allowed requests; allow if fewer than 10 are in the last 1000 ms | **Yes, exactly**, by construction                                          | O(limit): at most 10 numbers | **Exact**: `oldest + 1000 - now`   |

Why the sliding window log (`SlidingWindowLogStrategy`):

1. **Correctness.** It is the only one of the three that guarantees the stated limit in every 1-second span. The
   other two are cheaper approximations that allow bursts above the limit. The randomised invariant test checks this
   property directly.
2. **Exact `retryAfterMs`.** The requirement asks how many milliseconds to wait. The log knows exactly when the oldest
   request leaves the window, so the answer is exact rather than an estimate.
3. **Small cost at this limit.** Memory and time per check are O(limit) per active consumer: at most 10 numbers here.
   Idle consumers are evicted by the store's sweep.
4. **Denied requests are not recorded**, so a client that keeps retrying doesn't push its own wait further out.

When to choose differently: with large limits (for example 10,000 per minute) the log gets expensive. A **sliding
window counter** (two weighted fixed-window counters) approximates it with O(1) memory, and a **token bucket** is the
right fit when bursts are actually wanted. Either would be a new `RateLimitStrategy` class; `RateLimiter` doesn't
change.

## Extension (a): limits per resource and per consumer (built)

Pass a `ConfigurablePolicyResolver` as `policies`. The most specific rule wins:
**override (resource + consumer) → consumer → resource → default**. A consumer without a `resource` uses
`DEFAULT_RESOURCE` (`"default"`).

```ts
import { ConfigurablePolicyResolver, createRateLimiter } from './src';

const limiter = createRateLimiter({
  policies: new ConfigurablePolicyResolver({
    default: { limit: 10, windowMs: 1000 },
    resources: { search: { limit: 5, windowMs: 1000 } }, // everyone, on "search"
    consumers: { 'partner-acme': { limit: 100, windowMs: 1000 } }, // this consumer, everywhere
    overrides: { search: { 'partner-acme': { limit: 50, windowMs: 1000 } } }, // this pair
  }),
});

await limiter.check({ consumerId: 'partner-acme', resource: 'search' }); // 50 per second
await limiter.check({ consumerId: 'partner-acme' }); // 100 per second
await limiter.check({ consumerId: 'someone-else', resource: 'search' }); // 5 per second
```

- **Validation.** The constructor checks every rule and throws `InvalidArgumentError` if a `limit` or `windowMs` is
  not a positive safe integer. The message names the rule, for example
  `overrides.search.partner-acme.limit must be a positive integer, got 0`. A bad policy would otherwise deny every
  request with a zero wait, so a retrying client would spin.
- **Separate quotas.** Each resource/consumer pair is counted separately (the store key is
  `JSON.stringify([resource, consumerId])`, which can't collide).
- **Other sources.** `PolicyResolver` is an interface, so rules can come from a database, feature flags or a pricing
  plan by writing another resolver. `createRateLimiter` doesn't validate a custom resolver's policies, so it must
  return positive integers itself.

## Extension (b): use in a highly available web application (design)

The `InMemoryStore` is per process. With N app instances behind a load balancer, each allows 10/s, so together they
allow N × 10/s. The design for high availability (not built yet, see
[Known limitations](#known-limitations-and-deferred-items)):

1. **Shared state in Redis.** The public API is already async, so callers don't change. Two ways to plug it in:
   a `RedisStore` behind the existing `RateLimitStore` port, which must make `update` atomic with optimistic
   `WATCH`/`MULTI` retries because the transition is JavaScript; or, simpler and faster, a Redis-backed
   `RateLimitStrategy` that runs the whole check in Redis as the script below. `createRateLimiter` takes a `store` but
   not a strategy, so the second option needs a factory option or manual wiring (as in the Decorator example below).
2. **Atomic check-and-record.** Run the whole sliding-window step as one Lua script, so two instances can't both take
   the last slot:

   ```lua
   -- KEYS[1] = key; ARGV[1] = limit; ARGV[2] = windowMs
   local t = redis.call('TIME')
   local now = t[1] * 1000 + math.floor(t[2] / 1000)
   local limit, window = tonumber(ARGV[1]), tonumber(ARGV[2])
   redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
   local count = redis.call('ZCARD', KEYS[1])
   if count < limit then
     redis.call('ZADD', KEYS[1], now, now .. '-' .. math.random())
     redis.call('PEXPIRE', KEYS[1], window)
     return {1, limit - count - 1, 0}          -- allowed, remaining, retryAfterMs
   end
   local oldest = tonumber(redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')[2])
   return {0, 0, oldest + window - now}        -- denied, remaining, retryAfterMs
   ```

3. **One clock.** The script uses Redis `TIME`, so differences between the app servers' clocks don't matter.
4. **Redis Cluster.** A single-key script always runs on one shard. If a check ever touches several keys (for example
   a per-consumer and a per-resource limit in one script), give them a common hash tag such as `rl:{<consumerId>}:…`
   so they land on the same slot. Hash or escape IDs that may contain `{` or `}`.
5. **Failure policy.** Decide explicitly what happens when Redis is down or slow. **Fail-open** keeps serving users
   but drops the limit. **Fail-closed** protects the backend but turns a Redis outage into an outage. A common middle
   ground is a short timeout, then a fallback to a per-instance `InMemoryStore` limiter with `limit / N`, with a
   circuit breaker so an unhealthy Redis isn't hammered.
6. **Replication.** With asynchronous replication, a failover can lose a few recent timestamps. For rate limiting that
   means a brief over-allowance, which is usually acceptable. Document it rather than pay for synchronous replication.
7. **Latency.** Each check is one round trip to Redis (about 0.1–1 ms in the same region). For very hot paths, a
   **local pre-check** can deny consumers that are clearly over the limit without asking Redis.
8. **Edge / gateway.** Enforce coarse limits (for example per IP) at the API gateway or CDN as well, and keep this
   library for fine-grained, per-consumer business limits.

## Rate limiting vs concurrency limiting, and client retries

**[p-limit](https://github.com/sindresorhus/p-limit)** limits **concurrency**: how many promises are _in flight_ at
once. This library limits **rate**: how many calls _start_ within a time window. They solve different problems and
combine well. For example, `p-limit(3)` caps open connections while `withRateLimit` keeps you within an API's 10/s
quota (`p-limit` is not a dependency of this repo):

```ts
import pLimit from 'p-limit';

import { createRateLimiter, withRateLimit } from './src';

const limiter = createRateLimiter({ defaultPolicy: { limit: 10, windowMs: 1000 } });
const concurrency = pLimit(3);
const throttled = withRateLimit(limiter, { consumerId: 'my-service' }, callApi);

await Promise.all(ids.map((id) => concurrency(() => throttled(id))));
```

Ideas from **retry libraries** (Python `urllib3.Retry` and `tenacity`) are built into `acquire()`:

| Retry concept                                        | Here                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Respect `Retry-After` (`respect_retry_after_header`) | `acquire` waits the **exact** `retryAfterMs` instead of guessing with exponential backoff                               |
| `stop_after_delay` / `stop_after_attempt`            | `maxWaitMs` / `maxAttempts`. `acquire` **fails fast** with `RateLimitTimeoutError` instead of sleeping and then failing |
| `wait_random` jitter                                 | `jitterMs` adds `0..jitterMs` **on top of** the exact wait, so waiters don't retry in lockstep, and never too early     |
| Cancellation                                         | `signal` (`AbortSignal`) cancels the wait at once                                                                       |

```ts
import { acquire, createRateLimiter, RateLimitTimeoutError } from './src';

const limiter = createRateLimiter({ defaultPolicy: { limit: 10, windowMs: 1000 } });

try {
  await acquire(
    limiter,
    { consumerId: 'nightly-job' },
    { maxWaitMs: 5000, jitterMs: 50, signal: AbortSignal.timeout(10_000) },
  );
  // A slot is ours: do the work.
} catch (error: unknown) {
  if (error instanceof RateLimitTimeoutError) {
    console.log(`Gave up; next slot in ${String(error.lastResult.retryAfterMs)} ms`);
  } else {
    throw error; // abort reason or InvalidArgumentError
  }
}
```

Clients in other languages work with an HTTP service that sends these headers unchanged. For example, in Python:

```python
import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

retry = Retry(total=5, status_forcelist=[429], respect_retry_after_header=True, backoff_jitter=0.1)
session = requests.Session()
session.mount("https://", HTTPAdapter(max_retries=retry))
```

## Known limitations and deferred items

These match the deferred rows of the NFR table in [`docs/plans/rate-limiter.md`](./docs/plans/rate-limiter.md).

- **No shared `RedisStore` yet.** State is per process, so with N instances the effective limit is **N × limit**.
  Next step: extension (b), shared state in Redis behind the existing ports. The API is already async, so callers
  don't change.
- **Unique consumer IDs grow memory.** Every distinct key is kept until its TTL (`windowMs`) has passed and the next
  sweep runs (at most once per TTL, triggered by a check). There is **no max-keys cap**, so a flood of unique IDs
  within one window grows memory. Mitigation: limit unauthenticated traffic per IP at the gateway, derive
  `consumerId` from authenticated identities only, or use the Redis store.
- **No logging or metrics yet.** Allow/deny decisions are not logged or counted, `LOG_LEVEL` is not used, and no
  logger port exists. Callers log in their middleware today. The hook is a **Decorator** over `RateLimitStrategy`.

A logging/metrics Decorator wraps any strategy without changing it. `createRateLimiter` doesn't take a strategy, so
wire it by hand:

```ts
import {
  ConfigurablePolicyResolver,
  InMemoryStore,
  RateLimiter,
  SlidingWindowLogStrategy,
  SystemClock,
  type LimitPolicy,
  type RateLimitResult,
  type RateLimitStrategy,
  type SlidingWindowLog,
} from './src';

class LoggingStrategy implements RateLimitStrategy {
  public constructor(
    private readonly inner: RateLimitStrategy,
    private readonly log: (line: string) => void,
  ) {}

  public async consume(key: string, policy: LimitPolicy): Promise<RateLimitResult> {
    const result = await this.inner.consume(key, policy);
    this.log(
      `${key} ${result.allowed ? 'allowed' : 'denied'} remaining=${String(result.remaining)}`,
    );
    return result;
  }
}

const clock = new SystemClock();
const strategy = new SlidingWindowLogStrategy(new InMemoryStore<SlidingWindowLog>(clock), clock);
const limiter = new RateLimiter(
  new ConfigurablePolicyResolver({ default: { limit: 10, windowMs: 1000 } }),
  new LoggingStrategy(strategy, console.log),
);
```

## Future improvements

Ideas for where this could go next, roughly in priority order. The first group closes the gaps listed under
[Known limitations](#known-limitations-and-deferred-items). Effort: **S** = a single PR, **M** = a few PRs.

### Scalability and high availability

| Idea                               | Why                                                                                                                                                    | Effort |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Redis-backed strategy (Lua script) | One shared limit across all instances, instead of N × limit. Design in [extension (b)](#extension-b-use-in-a-highly-available-web-application-design). | M      |
| Max-keys cap with LRU eviction     | Bounds memory under a flood of unique consumer IDs, instead of waiting for the sweep.                                                                  | S      |
| Sliding window counter strategy    | O(1) memory per key for large limits (e.g. 10,000/min), where a timestamp log gets expensive.                                                          | S      |
| Token bucket strategy              | For APIs that want to allow short bursts on purpose. Drops in as another `RateLimitStrategy`.                                                          | S      |
| Several limits at once             | e.g. 10/s **and** 1,000/day per consumer, via a composite strategy that denies if any limit denies.                                                    | M      |

### Features

| Idea                                                | Why                                                                                                            | Effort |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| `strategy` option on `createRateLimiter`            | Lets callers plug in decorators (logging, metrics) without wiring classes by hand, as the sketch above has to. | S      |
| Weighted requests                                   | Let an expensive call (e.g. a bulk export) cost more than 1 unit of quota.                                     | M      |
| Policies from a database or pricing plan            | A `PolicyResolver` that loads per-plan limits, with caching and hot reload, so limits change without a deploy. | M      |
| Structured `RateLimit` / `RateLimit-Policy` headers | Newer revisions of the IETF draft merge the headers into structured fields; only `toRateLimitHeaders` changes. | S      |
| Framework middleware packages                       | Ready-made Express, Fastify and Hono middleware (consumer extraction, headers, `429`), published separately.   | M      |
| Per-call cancellation in `withRateLimit`            | Accept an `AbortSignal` per call, not only one for the whole wrapper.                                          | S      |

### Observability

| Idea                            | Why                                                                                                           | Effort |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Logger port + logging Decorator | Structured allow/deny logs that honour `LOG_LEVEL`, without touching the strategy.                            | S      |
| Metrics (e.g. OpenTelemetry)    | Counters for allowed/denied per resource and a histogram of `retryAfterMs`, to tune limits from real traffic. | M      |

### Quality and delivery

| Idea                      | Why                                                                                                               | Effort |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| CI on every pull request  | Run `pnpm check` in GitHub Actions and require it (plus up-to-date branches) before merge.                        | S      |
| Property-based tests      | Generalise the seeded invariant test with a library such as fast-check: random policies, arrivals and clocks.     | S      |
| Mutation testing          | Tools such as Stryker show which code changes the tests would miss.                                               | M      |
| Benchmarks                | Measure checks per second and memory per key, so the scalability claims are backed by numbers.                    | S      |
| Publish as an npm package | Semantic-versioned releases (e.g. with changesets), once the package has `exports` and bundled type declarations. | M      |

## Project structure

```
src/
├── index.ts              # composition root: the public API
├── rateLimit.ts          # default rateLimit(), built lazily from getConfig()
├── config/               # env.ts (Zod schema + parseEnv) and config.ts (lazy getConfig singleton)
├── domain/               # RateLimiter, SystemClock, Consumer / LimitPolicy / RateLimitResult types
├── interfaces/           # ports: Clock, PolicyResolver, RateLimitStore, RateLimitStrategy
├── strategies/           # SlidingWindowLogStrategy (Strategy)
├── stores/               # InMemoryStore (Adapter)
├── policies/             # ConfigurablePolicyResolver
├── factories/            # createRateLimiter (Factory)
├── http/                 # toRateLimitHeaders
├── client/               # acquire, withRateLimit (Decorator-style wrapper)
├── errors/               # AppError, InvalidArgumentError, RateLimitError, RateLimitTimeoutError
├── testing/              # FakeClock (test helper, not exported from index.ts)
├── treeshaking.test.ts   # tooling test: barrels stay tree-shakeable
└── lint-rules.test.ts    # tooling test: the import lint rules fire
```

Each directory has an `index.ts` barrel, and tests sit next to their source (`Foo.ts` → `Foo.test.ts`).

- Engineering rules (OOAD, SOLID, GoF patterns, strict TypeScript, env config, TDD, workflow): [`CLAUDE.md`](./CLAUDE.md)
- Design note (use cases, responsibilities, patterns, class diagram):
  [`docs/design/rate-limiter.md`](./docs/design/rate-limiter.md)
- Task plan and non-functional requirements: [`docs/plans/rate-limiter.md`](./docs/plans/rate-limiter.md)
- Presentation of the design and solution: [`docs/presentation/rate-limiter.pdf`](./docs/presentation/rate-limiter.pdf)
  (or [`rate-limiter.html`](./docs/presentation/rate-limiter.html), self-contained, opens in any browser)
