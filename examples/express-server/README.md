# Express server example

An Express server that uses the rate limiter the way a real consumer would: only through the package's public
exports (`import … from 'coding-challenge-loic-wong'`), never its `src/`. It is a local-only example: every package
it uses, Express included, is a devDependency, and nothing here is part of the library. End-to-end tests drive it over
real HTTP.

Design and task plan: [`docs/design/express-e2e-example.md`](../../docs/design/express-e2e-example.md),
[`docs/plans/express-e2e-example.md`](../../docs/plans/express-e2e-example.md).

## Quick start

From the repo root (Node 24, pnpm):

```bash
pnpm install
pnpm example:start            # builds the library and the example, then runs node dist/main.js
PORT=4000 pnpm example:start  # another port; PORT=0 lets the OS pick a free one (printed at startup)
pnpm example:dev              # builds the library, then tsx watch src/main.ts (restarts on change)
pnpm example:demo             # self-contained demo: starts the server, runs every scenario, stops it
```

The server listens on port `3000` by default and logs `Listening on http://localhost:3000`. `Ctrl-C` (or `SIGTERM`)
closes it cleanly.

### The demo

`pnpm example:demo` builds everything, then runs [`scripts/demo.sh`](./scripts/demo.sh) (bash 3.2+ and curl only). It
starts the built server on a free port with its own short limits (5 per 2000 ms, `/api/search` 2, `partner-acme` 20,
upstream 2 per 1000 ms with a 1500 ms wait cap), set explicitly so your `.env` can't change them. Then it runs each
scenario with curl, prints the request, status and headers with `PASS`/`FAIL`, and always stops the server (also on
failure or `Ctrl-C`). Trimmed output:

```text
== 2. Over the limit: 429 with Retry-After ==
$ curl -H 'X-Consumer-Id: alice' http://localhost:56993/api/resource
  HTTP 429  RateLimit-Limit: 5  RateLimit-Remaining: 0  RateLimit-Reset: 2  Retry-After: 2
  body: {"error":"Too Many Requests","retryAfterMs":1779}
  PASS status = 429
  PASS RateLimit-Remaining = 0
  PASS Retry-After present (2 s)
...
== 8. /api/report spreads upstream calls (2 per 1000 ms) instead of failing ==
$ curl -H 'X-Consumer-Id: burst-<i>' http://localhost:56993/api/report/r<i>   (x4, concurrently)
  request 1: HTTP 200 in 1002 ms
  request 2: HTTP 200 in 1 ms
  request 3: HTTP 200 in 2 ms
  request 4: HTTP 200 in 1003 ms
  PASS requests answered 200 = 4
  PASS slowest - fastest = 1002 ms (>= 500 ms: later calls waited for upstream slots)
...
31 passed, 0 failed
```

| Exit code | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `0`       | Every check passed                                                           |
| `1`       | At least one check failed, or the server never became healthy                |
| `2`       | Usage error: unknown argument, or `dist/main.js` missing (run from the root) |

Colours are used only on a terminal; set `NO_COLOR=1` to turn them off. `bash scripts/demo.sh --self-test-fail` (from
this directory, after a build) adds one check that cannot pass, to show the failure path (exit `1`, server stopped).

## Endpoints

Every rate-limited route needs an `X-Consumer-Id` header: 1–64 characters from `A-Z a-z 0-9 . _ -`. A missing,
invalid or duplicated header is rejected with `400` before the limiter runs, so it uses no quota.

| Route                 | Rate-limit resource | Success                                        | Errors                                                     |
| --------------------- | ------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `GET /health`         | none (unthrottled)  | `200` `{"status":"ok"}`                        | none                                                       |
| `GET /api/resource`   | `resource`          | `200` `{"resource":"resource","consumerId":…}` | `400`, `429`, `503` (limiter)                              |
| `GET /api/search`     | `search`            | `200` `{"resource":"search","consumerId":…}`   | `400`, `429`, `503` (limiter)                              |
| `GET /api/report/:id` | `report`            | `200` `{"id":…,"title":"Report <id>"}`         | `400`, `429`, `503` (limiter), `502`, `503` (upstream cap) |

Error responses (all JSON):

| Status | When                                                                                       | Body                                                           | Headers                      |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------- |
| `400`  | Missing or invalid `X-Consumer-Id`                                                         | `{"error":"Missing or invalid X-Consumer-Id header"}`          | none                         |
| `400`  | `/api/report/:id` with an id outside 1–64 of `A-Z a-z 0-9 . _ -` (checked after the limit) | `{"error":"Invalid report id"}`                                | `RateLimit-*`                |
| `429`  | The consumer is over its limit for that resource                                           | `{"error":"Too Many Requests","retryAfterMs":<ms>}`            | `RateLimit-*`, `Retry-After` |
| `503`  | The limiter itself fails (fail closed: never an unthrottled `200`)                         | `{"error":"Rate limiter unavailable"}`                         | none                         |
| `502`  | `/api/report`: the upstream call fails (its details are not sent to the client)            | `{"error":"Upstream request failed"}`                          | `RateLimit-*`                |
| `503`  | `/api/report`: waiting for an upstream slot would exceed `UPSTREAM_MAX_WAIT_MS`            | `{"error":"Upstream rate limit exceeded","retryAfterMs":<ms>}` | `RateLimit-*`, `Retry-After` |

`/api/report` has two limits. The consumer's own limit (resource `report`) applies first and answers `429`. Then the
server calls a fake in-process upstream through the library's `withRateLimit`, with one quota for the whole server
(`UPSTREAM_*`): a burst of report requests is spread out to respect the upstream's quota instead of failing, and
only requests that would wait longer than the cap get `503`.

### Headers

Allowed and denied requests carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (relative seconds,
rounded up); denied ones (`429`, and the upstream-cap `503`) also carry `Retry-After` in seconds. The request that uses
the last unit is still `200` with `RateLimit-Remaining: 0` and no `Retry-After`. See the root README's
[HTTP headers](../../README.md#http-headers) section for the exact semantics.

## Try it with curl

Start the server with the default configuration (`pnpm example:start`, port 3000), then in another terminal. The
outputs below are real runs, trimmed.

The default limit is 10 per second per consumer, so the 11th request in a burst is denied:

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code} ' -H 'X-Consumer-Id: alice' localhost:3000/api/resource
done; echo
```

```text
200 200 200 200 200 200 200 200 200 200 429
```

The headers on an allowed and a denied request:

```bash
curl -i -H 'X-Consumer-Id: bob' localhost:3000/api/resource
```

```text
HTTP/1.1 200 OK
RateLimit-Limit: 10
RateLimit-Remaining: 9
RateLimit-Reset: 1
Content-Type: application/json; charset=utf-8

{"resource":"resource","consumerId":"bob"}
```

```text
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 1
Retry-After: 1
Content-Type: application/json; charset=utf-8

{"error":"Too Many Requests","retryAfterMs":850}
```

A missing (or invalid) consumer ID:

```bash
curl -i localhost:3000/api/resource
```

```text
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"Missing or invalid X-Consumer-Id header"}
```

`/api/search` is stricter (3 per second by default):

```bash
for i in 1 2 3 4; do
  curl -s -w ' %{http_code}\n' -H 'X-Consumer-Id: carol' localhost:3000/api/search
done
```

```text
{"resource":"search","consumerId":"carol"} 200
{"resource":"search","consumerId":"carol"} 200
{"resource":"search","consumerId":"carol"} 200
{"error":"Too Many Requests","retryAfterMs":957} 429
```

The partner consumer `partner-acme` gets 50 per second, and 20 on `/api/search`:

```bash
curl -s -D - -o /dev/null -H 'X-Consumer-Id: partner-acme' localhost:3000/api/resource | grep -i ratelimit-limit
curl -s -D - -o /dev/null -H 'X-Consumer-Id: partner-acme' localhost:3000/api/search | grep -i ratelimit-limit
```

```text
RateLimit-Limit: 50
RateLimit-Limit: 20
```

A concurrent `/api/report` burst, one consumer per request so only the upstream limit (5 per second) matters. All 12
succeed; calls beyond the upstream quota wait for the next second:

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "r$i %{http_code} %{time_total}s\n" \
    -H "X-Consumer-Id: user-$i" localhost:3000/api/report/r$i &
done; wait
```

```text
r1 200 0.001102s
r2 200 0.001290s
...
r7 200 0.990578s
r8 200 0.989037s
...
r5 200 1.993293s
r11 200 1.989319s
```

With 20 at once, the requests that would wait more than `UPSTREAM_MAX_WAIT_MS` (2000 ms) get `503`:

```bash
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -H "X-Consumer-Id: user-$i" localhost:3000/api/report/r$i &
done | sort | uniq -c; wait
```

```text
  15 200
   5 503
```

```text
HTTP/1.1 503 Service Unavailable
RateLimit-Limit: 10
RateLimit-Remaining: 9
RateLimit-Reset: 1
Retry-After: 1
Content-Type: application/json; charset=utf-8

{"error":"Upstream rate limit exceeded","retryAfterMs":989}
```

## Configuration

Every variable is optional and documented in [`.env.example`](./.env.example). Copy it to `.env` in this directory
to override values; variables already set in the environment win over `.env`. An empty value (`PORT=`) counts as
unset.

| Variable                           | Default    | Meaning                                                                            |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `PORT`                             | `3000`     | TCP port, `0`–`65535`. `0` lets the OS pick a free port, shown in the startup log. |
| `RATE_LIMIT_MAX_REQUESTS`          | `10`       | Default policy: requests per consumer per window (positive integer).               |
| `RATE_LIMIT_WINDOW_MS`             | `1000`     | Default policy: sliding window length in ms (positive integer).                    |
| `RATE_LIMIT_POLICIES`              | demo rules | Per-resource / per-consumer rules as JSON (below).                                 |
| `UPSTREAM_RATE_LIMIT_MAX_REQUESTS` | `5`        | Upstream calls `/api/report` may make per window, for the whole server.            |
| `UPSTREAM_RATE_LIMIT_WINDOW_MS`    | `1000`     | The upstream's window in ms.                                                       |
| `UPSTREAM_MAX_WAIT_MS`             | `2000`     | Longest a request waits for an upstream slot before answering `503`.               |

`RATE_LIMIT_POLICIES` is a JSON object with three optional sections; each policy is
`{"limit": <positive integer>, "windowMs": <positive integer>}`. The most specific rule wins:
`overrides[resource][consumer]` → `consumers[consumer]` → `resources[resource]` → the default policy above. Resources
are `resource`, `search` and `report`. When the variable is unset or empty, these demo rules apply:

```json
{
  "resources": { "search": { "limit": 3, "windowMs": 1000 } },
  "consumers": { "partner-acme": { "limit": 50, "windowMs": 1000 } },
  "overrides": { "search": { "partner-acme": { "limit": 20, "windowMs": 1000 } } }
}
```

Setting the variable replaces the demo rules entirely (e.g. `RATE_LIMIT_POLICIES='{}'` leaves only the default
policy). Invalid configuration fails fast: the server exits with code `1` before listening, naming every bad field
(run here from this directory after a build):

```text
$ RATE_LIMIT_POLICIES='{"resources":{"search":{"limit":0,"windowMs":1000}}}' node dist/main.js
Invalid example configuration:
  - RATE_LIMIT_POLICIES.resources.search.limit: Too small: expected number to be >0
```

## Tests

From the repo root:

| Command               | What it runs                                                                    |
| --------------------- | ------------------------------------------------------------------------------- |
| `pnpm check:examples` | Builds the library (`pnpm build`), then the example's typecheck + lint + tests. |
| `pnpm check:all`      | `pnpm check` (the library) and `pnpm check:examples`.                           |

`pnpm check` stays library-only. To run only the example's tests, build the library first (the example imports the
built `dist/`): `pnpm build && pnpm --filter express-server-example test`.

The E2E scenarios from the design note, and where they are tested:

| #   | Scenario                                                             | Test file                                          |
| --- | -------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Allowed requests carry `RateLimit-*`; remaining counts down          | `src/resource.e2e.test.ts`                         |
| 2   | The request that reaches remaining 0 is `200`, without `Retry-After` | `src/resource.e2e.test.ts`                         |
| 3   | The next one is `429` with `Retry-After` and `retryAfterMs`          | `src/resource.e2e.test.ts`                         |
| 4   | Allowed again after waiting `retryAfterMs`                           | `src/resource.e2e.test.ts`                         |
| 5   | Sliding window: slots free up one by one                             | `src/resource.e2e.test.ts`                         |
| 6   | Hammering while blocked does not extend the wait                     | `src/resource.e2e.test.ts`                         |
| 7   | Consumers and resources are isolated                                 | `src/resource.e2e.test.ts`                         |
| 8   | A concurrent burst allows exactly `limit`                            | `src/resource.e2e.test.ts`                         |
| 9   | Invalid `X-Consumer-Id` → `400`, no quota used                       | `src/resource.e2e.test.ts`                         |
| 10  | Per-resource, per-consumer and override policies                     | `src/policies.e2e.test.ts`, `src/main.e2e.test.ts` |
| 11  | `/api/report` burst succeeds within the upstream limit               | `src/report.e2e.test.ts`                           |
| 12  | `/api/report` wait over the cap → `503` with `Retry-After`           | `src/report.e2e.test.ts`                           |
| 13  | A failing limiter fails closed with `503`                            | `src/resource.e2e.test.ts`                         |
| 14  | Invalid limits fail fast                                             | `src/policies.e2e.test.ts`, `src/main.e2e.test.ts` |

`src/main.e2e.test.ts` also runs the built server (`node dist/main.js`) as a child process, and
`src/demo.e2e.test.ts` runs `scripts/demo.sh` (skipped without bash and curl).

How the suite stays reliable:

- Short real windows (e.g. 5 per 300 ms) with small timing tolerances instead of fake timers, so the HTTP path is real
  and the suite still runs in seconds.
- No fixed ports: in-process servers listen on port `0` bound to `127.0.0.1`, and the built server starts with
  `PORT=0` and reports its port in the startup log, so nothing can take the port between choosing and binding it.
- One build of `dist/main.js` for the whole run, in Vitest's `globalSetup`
  ([`src/buildServer.globalSetup.ts`](./src/buildServer.globalSetup.ts)), so parallel test files never rebuild it
  under each other.

## Notes for contributors

- The example's ESLint config is type-aware and resolves `coding-challenge-loic-wong` to the built `dist/index.d.ts`.
  On a fresh clone where `pnpm build` never ran, committing example `.ts` files fails the pre-commit lint until you
  run `pnpm build` once at the root.
- Lint blocks imports of library internals (`coding-challenge-loic-wong/…`, `@/…`, `../../src`): use the package
  entry point only. Only `src/main.ts` may read `process.env`.

## Limitations

- **Per-process state.** The limiter uses the library's in-memory store, so N server instances allow N × limit. See
  the root README's
  [Extension (b)](../../README.md#extension-b-use-in-a-highly-available-web-application-design) for the shared-store
  design.
- **The upstream is a fake.** `FakeUpstreamClient` answers in-process; a real one would implement the same
  `UpstreamClient` interface.
- **No logging.** Allow/deny decisions are not logged, as in the library; see
  [Known limitations](../../README.md#known-limitations-and-deferred-items) and
  [Future improvements](../../README.md#future-improvements).

## Project structure

```
examples/express-server/
├── .env.example                  # every variable, with defaults
├── package.json                  # scripts: build, start, dev, typecheck, lint, test, check
├── eslint.config.js              # root rules + public-API-only import guard
├── tsconfig.json                 # same strict flags as the library
├── vitest.config.ts              # globalSetup builds dist/main.js once
├── scripts/
│   └── demo.sh                   # bash + curl demo (pnpm example:demo)
└── src/
    ├── main.ts                   # composition root: config, limiters, upstream, listen, shutdown
    ├── app.ts                    # createApp(deps): routes, no listen, no env
    ├── rateLimitMiddleware.ts    # X-Consumer-Id → limiter → headers / 400 / 429 / 503
    ├── consumerId.ts             # X-Consumer-Id validation
    ├── reportRoute.ts            # GET /api/report/:id → 200 / 400 / 502 / 503
    ├── upstream.ts               # UpstreamClient port + rateLimitedFetchReport (withRateLimit)
    ├── FakeUpstreamClient.ts     # in-process upstream
    ├── config.ts                 # loadExampleConfig(env): Zod-validated config
    ├── policiesConfig.ts         # RATE_LIMIT_POLICIES schema + demo rules
    ├── testServer.ts             # test helper: listen on 127.0.0.1:0, close all
    ├── buildServer.globalSetup.ts
    └── *.test.ts, *.e2e.test.ts  # unit and E2E tests next to the code
```
