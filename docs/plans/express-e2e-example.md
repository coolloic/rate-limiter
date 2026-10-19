# Express E2E Example — Task Plan

Design: [`docs/design/express-e2e-example.md`](../design/express-e2e-example.md).

| #   | Task                                                         | Branch                        | Depends on | Status |
| --- | ------------------------------------------------------------ | ----------------------------- | ---------- | ------ |
| 1   | Design note + task plan                                      | docs/express-e2e-design       | —          | done   |
| 2   | Library package exports + bundled type declarations          | feat/package-exports          | 1          | done   |
| 3   | Example workspace package scaffold + `check:examples`        | feat/express-example-scaffold | 2          | done   |
| 4   | Rate-limit middleware + `/api/resource` + core E2E scenarios | feat/express-example-core     | 3          | done   |
| 5   | Per-resource/consumer policies + example policy config       | feat/express-example-policies | 4          | done   |
| 6   | `/api/report` with `withRateLimit` upstream + cap → `503`    | feat/express-example-report   | 4          | done   |
| 7   | Example README                                               | docs/express-example-readme   | 6, 8       | done   |
| 8   | Self-contained bash demo (`pnpm example:demo`)               | feat/express-example-demo     | 5, 6, 9    | done   |
| 9   | Run scripts: `main.ts`, `pnpm example:start` / `example:dev` | feat/express-example-run      | 3          | done   |

Execution order:

```
1 → 2 → 3 → (4 ∥ 9)
4 → (5 ∥ 6)
(5, 6, 9) → 8 → 7
```

## Non-functional requirements

| NFR             | Criterion (verifiable)                                                                                                                          | Task(s) | Status |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| Maintainability | The example imports only the package's public API; a check fails if it imports library internals (`src/`, `@/`).                                | 2, 3    | done   |
| Maintainability | Express, its types and the E2E tooling are dependencies of the example only, never of the library.                                              | 3       | done   |
| Readability     | Small single-purpose files (app, middleware, routes, config, entry); example README covers run + test.                                          | 4, 7    | done   |
| Security        | `X-Consumer-Id` is validated (non-empty, ≤ 64 chars, `[A-Za-z0-9._-]`) → `400`, and uses no quota (tested).                                     | 4       | done   |
| Security        | Limiter/store errors fail closed: `503`, never an unthrottled `200` (tested with a failing store).                                              | 4       | done   |
| Reliability     | E2E timing uses short real windows with tolerances; the example suite runs in < 10 s and passes 5 runs in a row.                                | 4, 5, 6 | done   |
| Portability     | The bash demo needs only `bash` and `curl`, runs on macOS (bash 3.2) and Linux, and always stops its server (tested by running it from Vitest). | 8       | done   |
| Observability   | Every response carries `RateLimit-*` headers; `429`/`503` bodies are JSON `{ error, retryAfterMs }`.                                            | 4, 6    | done   |
| Scalability     | Per-process in-memory store: documented in the example README, pointing at the library's HA design.                                             | 7       | done   |

## Task details

Each code task follows TDD (§8.2). E2E tests start the app with `app.listen(0)` and call it with `fetch`; every test
closes its server. Timing assertions use short windows (e.g. 300 ms) and a tolerance (e.g. ±50 ms).

### 1. Design note + task plan

- `docs/design/express-e2e-example.md` and this plan.

### 2. Library package exports + bundled type declarations

- `package.json`: `exports` (`types` → `./dist/index.d.ts`, `import` → `./dist/index.js`) and `files: ["dist"]`.
- `pnpm build` also emits one bundled `dist/index.d.ts` with no `@/` specifiers (pick the smallest tool that bundles
  declarations and resolves `paths`, e.g. `dts-bundle-generator`; justify the choice in the PR).
- Test: build the declarations and assert the file exists, contains no `@/` imports, and declares the public API
  (`rateLimit`, `createRateLimiter`, `toRateLimitHeaders`, `acquire`, `withRateLimit`).
- NFR (maintainability): consumers get the public API only, through `exports`.

### 3. Example workspace package scaffold + `check:examples`

- `pnpm-workspace.yaml`: add `packages: ['examples/*']`.
- `examples/express-server/`: `package.json` (deps: library via `workspace:*`, `express`; dev: `@types/express`,
  `vitest`, …), `tsconfig.json` (same strict flags as the root), ESLint config (reuse the root rules), Vitest config.
- A minimal `createApp()` with `GET /health` and one E2E test proving the server starts on an ephemeral port and the
  library resolves through the package `exports` (its build runs first).
- Root scripts: `check` stays library-only; `check:examples` builds the library and runs the example's `check`
  (`pnpm -r --filter './examples/**' check`); `check:all` runs both (for CI). The root ESLint/Vitest/tsc configs
  ignore `examples/` (the package checks itself).
- A lint rule or test that fails if the example imports the library's `src/` or `@/` paths.

### 4. Rate-limit middleware + `/api/resource` + core E2E scenarios

- `consumerIdFrom(req)` validation, `rateLimitMiddleware(limiter, resource?)`, `GET /api/resource`.
- `429` JSON body `{ error, retryAfterMs }`; store/limiter errors → `503` (fail closed).
- E2E scenarios 1–9 and 13 from the design note.

### 5. Per-resource/consumer policies + example policy config

- `GET /api/search`; extend the example config (from task 9) with the per-resource/consumer policies, wire them in
  `main.ts`, and document them in the example's `.env.example`.
- E2E scenarios 10 and 14.

### 6. `/api/report` with `withRateLimit` upstream + cap → `503`

- `UpstreamClient` interface + `FakeUpstreamClient`; the route wraps the upstream with `withRateLimit` and
  `maxWaitMs`; `RateLimitTimeoutError` → `503` with `Retry-After`.
- E2E scenarios 11 and 12.

### 7. Example README

- How to run the server (`pnpm example:start` / `example:dev`), the bash demo (`pnpm example:demo`) and the E2E tests, the endpoints and headers, curl examples, the scenario table, and the
  per-process limitation (link to the library README's HA section).

### 8. Self-contained bash demo (`pnpm example:demo`)

- `examples/express-server/scripts/demo.sh` (bash + curl only, no `jq`; works with macOS's bash 3.2), run by
  `pnpm example:demo` at the root (which builds the library and the example first, using task 9's scripts).
- The script starts the built server on a free port with a short window (e.g. limit 5 per 2 s, set through the same
  env variables `main.ts` reads), waits until `/health` answers, runs each scenario with `curl`, and stops the
  server on exit (`trap`, also on Ctrl-C or failure).
- For each scenario it prints the request, the status and the `RateLimit-*` / `Retry-After` headers, then
  `PASS`/`FAIL`. It exits non-zero if any check fails, so it doubles as a bash smoke test.
- Scenarios: allowed with headers counting down; the last allowed request has `remaining: 0`; the next is `429`
  with `Retry-After`; recovery after waiting; missing consumer ID → `400`; consumers isolated; per-resource limit
  on `/api/search`; the partner's higher limit; `/api/report` spreading upstream calls.
- A Vitest test runs the script once (skipped if `bash`/`curl` are missing) so `pnpm check:examples` keeps it working.

### 9. Run scripts: `main.ts`, `pnpm example:start` / `example:dev`

Moved forward from task 5 so the server can be run and tried with `curl` from the start; each later task's endpoints
are then usable by hand as soon as they merge.

- `src/config.ts`: `loadExampleConfig(env)`, pure and Zod-validated (`PORT`, default `3000`); `main.ts` is the only file that reads
  `process.env` (an ESLint override allows it there). The example's `.env.example` documents it.
- `src/main.ts`: composition root. Loads config (fail fast), `createApp()`, `listen(PORT)`, logs the URL, and closes
  the server cleanly on `SIGINT`/`SIGTERM`. No top-level work outside `main()`.
- Example scripts: `build` (esbuild bundles `src/main.ts` to `dist/main.js`, the library stays external), `start`
  (`build`, then `node dist/main.js`) and `dev` (`tsx watch src/main.ts`). Root scripts: `example:start` and
  `example:dev`, which build the library first.
- Tests: config parsing (defaults, valid port, invalid port rejected); an E2E test that starts the BUILT server as a
  child process on a free port, waits for `/health` to answer `200`, sends `SIGTERM`, and checks it exits cleanly.
- Verify by hand: `pnpm example:start`, then `curl -i localhost:3000/health`.
