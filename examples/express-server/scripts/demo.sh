#!/usr/bin/env bash
# Self-contained demo of the Express example: starts the BUILT server (dist/main.js) on a free port, runs each
# rate-limit scenario with curl, prints the request, status, headers and PASS/FAIL, then stops the server.
# Exits non-zero if any check fails, so it doubles as a smoke test.
#
# Usage: pnpm example:demo                 (from the repo root; builds the library and the example first)
#        bash scripts/demo.sh [--self-test-fail]
#   --self-test-fail  adds one check that cannot pass (proves the failure path: exit 1, server still stopped).
#
# Needs only bash (3.2+, so macOS's default works) and curl, plus the node that runs the server.
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$EXAMPLE_DIR"

SELF_TEST_FAIL=0
for arg in "$@"; do
  case "$arg" in
    --self-test-fail) SELF_TEST_FAIL=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ ! -f dist/main.js ]; then
  echo "dist/main.js not found: run 'pnpm example:demo' from the repo root (it builds first)." >&2
  exit 2
fi

# --- Demo configuration: every variable the server reads is set here, so a developer's .env cannot change it. ---
LIMIT=5          # requests per consumer per window (default policy)
WINDOW_MS=2000   # sliding window
SEARCH_LIMIT=2   # /api/search is stricter
PARTNER_LIMIT=20 # consumer partner-acme gets more
POLICIES="{\"resources\":{\"search\":{\"limit\":$SEARCH_LIMIT,\"windowMs\":$WINDOW_MS}},\
\"consumers\":{\"partner-acme\":{\"limit\":$PARTNER_LIMIT,\"windowMs\":$WINDOW_MS}}}"
UPSTREAM_LIMIT=2       # the upstream behind /api/report accepts 2 calls...
UPSTREAM_WINDOW_MS=1000 # ...per second, for the whole server
UPSTREAM_MAX_WAIT_MS=1500

# --- Output helpers: colours only on a terminal, and never when NO_COLOR is set (https://no-color.org). ---
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GREEN=$'\033[32m' RED=$'\033[31m' RESET=$'\033[0m'
else
  BOLD='' DIM='' GREEN='' RED='' RESET=''
fi

PASSED=0
FAILED=0
SERVER_PID=''
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/express-demo.XXXXXX")"
SERVER_LOG="$TMP_DIR/server.log"

# Runs on every exit path (success, failure, Ctrl-C, kill): stop what we started, by PID, then remove temp files.
# `jobs -p` lists only this script's background processes still running (a sleep or curls when interrupted), so no
# reaped PID that the OS may have reused is ever signalled. They hold nothing worth a graceful stop, and when
# interrupted mid-`wait`, bash 3.2 can leave SIGTERM blocked in them, so they get SIGKILL.
cleanup() {
  local pid
  trap '' INT TERM # a second Ctrl-C must not cut the cleanup short and leave the server running
  for pid in $(jobs -p); do
    if [ "$pid" != "$SERVER_PID" ]; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true # SIGTERM: main.ts closes the server and exits
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

heading() {
  printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RESET"
}

pass() {
  PASSED=$((PASSED + 1))
  printf '  %sPASS%s %s\n' "$GREEN" "$RESET" "$1"
}

fail() {
  FAILED=$((FAILED + 1))
  printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$1"
}

# expect_eq <what> <actual> <expected>
expect_eq() {
  if [ "$2" = "$3" ]; then
    pass "$1 = $3"
  else
    fail "$1: expected '$3', got '$2'"
  fi
}

# header_value <headers file> <name>: the header's value (case-insensitive name), or empty if absent.
header_value() {
  { grep -i "^$2:" "$1" || true; } | head -n 1 | cut -d: -f2- | tr -d ' \r'
}

# Sets STATUS, BODY and the RL_* variables from the last request's files.
read_response() {
  STATUS="$(cat "$TMP_DIR/status")"
  BODY="$(cat "$TMP_DIR/body")"
  RL_LIMIT="$(header_value "$TMP_DIR/headers" RateLimit-Limit)"
  RL_REMAINING="$(header_value "$TMP_DIR/headers" RateLimit-Remaining)"
  RL_RESET="$(header_value "$TMP_DIR/headers" RateLimit-Reset)"
  RETRY_AFTER="$(header_value "$TMP_DIR/headers" Retry-After)"
}

# request <path> [consumer id]: GET with curl, print the command and the response summary.
request() {
  local url="$BASE_URL$1"
  local consumer_args=()
  if [ "$#" -ge 2 ]; then
    consumer_args=(-H "X-Consumer-Id: $2")
    printf '%s$ curl -H '\''X-Consumer-Id: %s'\'' %s%s\n' "$DIM" "$2" "$url" "$RESET"
  else
    printf '%s$ curl %s%s\n' "$DIM" "$url" "$RESET"
  fi
  : >"$TMP_DIR/headers" # curl leaves the files untouched if it cannot connect: never show stale headers
  : >"$TMP_DIR/body"
  # "${arr[@]+...}": bash 3.2 treats an empty array as unset under `set -u`.
  curl -s --max-time 10 -o "$TMP_DIR/body" -D "$TMP_DIR/headers" -w '%{http_code}' \
    ${consumer_args[@]+"${consumer_args[@]}"} "$url" >"$TMP_DIR/status" || echo 000 >"$TMP_DIR/status"
  read_response
  printf '  HTTP %s' "$STATUS"
  print_header RateLimit-Limit "$RL_LIMIT"
  print_header RateLimit-Remaining "$RL_REMAINING"
  print_header RateLimit-Reset "$RL_RESET"
  print_header Retry-After "$RETRY_AFTER"
  printf '\n'
}

# print_header <name> <value>: prints "  name: value" unless the value is empty.
print_header() {
  if [ -n "$2" ]; then printf '  %s: %s' "$1" "$2"; fi
}

show_body() {
  printf '  body: %s\n' "$BODY"
}

# to_ms <seconds as printed by curl's time_total, e.g. 1.012345>: whole milliseconds, without bc or awk.
to_ms() {
  local seconds="${1%.*}" fraction="${1#*.}000"
  echo $((10#$seconds * 1000 + 10#${fraction:0:3}))
}

# sleep_ms <ms>: sleeps in the background and waits for it, so Ctrl-C is handled at once, not after the sleep.
sleep_ms() {
  sleep "$(($1 / 1000)).$(printf '%03d' $(($1 % 1000)))" &
  wait "$!"
}

# report_burst <prefix> <count>: GETs /api/report concurrently, one consumer each (so only the upstream limit
# matters). Each curl writes "<status> <time_total>" and its headers to temp files; we wait for exactly those PIDs.
report_burst() {
  local prefix="$1" count="$2" i pid pids=''
  printf '%s$ curl -H '\''X-Consumer-Id: %s-<i>'\'' %s/api/report/r<i>   (x%s, concurrently)%s\n' \
    "$DIM" "$prefix" "$BASE_URL" "$count" "$RESET"
  i=1
  while [ "$i" -le "$count" ]; do
    curl -s -o /dev/null -D "$TMP_DIR/$prefix-$i.headers" -w '%{http_code} %{time_total}' \
      --max-time 10 -H "X-Consumer-Id: $prefix-$i" "$BASE_URL/api/report/r$i" >"$TMP_DIR/$prefix-$i.result" &
    pids="$pids $!"
    i=$((i + 1))
  done
  for pid in $pids; do
    wait "$pid" || true # a failed curl is reported as status 000 below
  done
}

# burst_result <file>: "<status> <time_total>" from a burst curl, or "000 0.0" if it wrote nothing.
burst_result() {
  local result
  result="$(cat "$1")"
  echo "${result:-000 0.0}"
}

# --- Start the server ---
# free_port: the OS picks a port for a throwaway listener, which is then closed. node is already required to run
# the server, and neither bash nor curl can ask the OS for a free port portably.
free_port() {
  node -e 'const s = require("node:net").createServer().listen(0, () => { console.log(s.address().port); s.close(); });'
}

# start_server: starts dist/main.js on $PORT in the background, with every variable it reads set explicitly.
start_server() {
  PORT="$PORT" \
    RATE_LIMIT_MAX_REQUESTS="$LIMIT" \
    RATE_LIMIT_WINDOW_MS="$WINDOW_MS" \
    RATE_LIMIT_POLICIES="$POLICIES" \
    UPSTREAM_RATE_LIMIT_MAX_REQUESTS="$UPSTREAM_LIMIT" \
    UPSTREAM_RATE_LIMIT_WINDOW_MS="$UPSTREAM_WINDOW_MS" \
    UPSTREAM_MAX_WAIT_MS="$UPSTREAM_MAX_WAIT_MS" \
    node dist/main.js >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
}

# wait_until_healthy: returns 0 once /health answers 200, 1 if the server exits first; gives up after ~10 s.
wait_until_healthy() {
  local attempt=0
  until [ "$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "$BASE_URL/health" || true)" = 200 ]; do
    attempt=$((attempt + 1))
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      wait "$SERVER_PID" 2>/dev/null || true # reap it
      SERVER_PID=''
      return 1
    fi
    if [ "$attempt" -ge 100 ]; then return 1; fi
    sleep 0.1
  done
}

# Another process may take the port between free_port and the server's listen: then retry on a new port.
start_attempt=1
while :; do
  PORT="$(free_port)"
  BASE_URL="http://localhost:$PORT"
  heading "Starting the server on port $PORT"
  start_server
  if wait_until_healthy; then break; fi
  if [ -z "$SERVER_PID" ] && grep -q EADDRINUSE "$SERVER_LOG" && [ "$start_attempt" -lt 3 ]; then
    echo "  port $PORT was taken meanwhile; trying another one"
    start_attempt=$((start_attempt + 1))
    continue
  fi
  echo "The server did not become healthy. Its log:" >&2
  cat "$SERVER_LOG" >&2
  exit 1
done
echo "  limit $LIMIT per ${WINDOW_MS} ms per consumer; /api/search $SEARCH_LIMIT; partner-acme $PARTNER_LIMIT;"
echo "  upstream $UPSTREAM_LIMIT per ${UPSTREAM_WINDOW_MS} ms, max wait ${UPSTREAM_MAX_WAIT_MS} ms"
echo "  ready: $BASE_URL/health answers 200"

# --- Scenarios ---
heading "1. Allowed requests: RateLimit-Remaining counts down"
i=1
while [ "$i" -le "$LIMIT" ]; do
  request /api/resource alice
  expect_eq "status" "$STATUS" 200
  expect_eq "RateLimit-Remaining" "$RL_REMAINING" $((LIMIT - i))
  i=$((i + 1))
done
expect_eq "Retry-After on the last allowed request" "${RETRY_AFTER:-<none>}" "<none>"

heading "2. Over the limit: 429 with Retry-After"
request /api/resource alice
show_body
expect_eq "status" "$STATUS" 429
expect_eq "RateLimit-Remaining" "$RL_REMAINING" 0
if [ -n "$RETRY_AFTER" ]; then pass "Retry-After present ($RETRY_AFTER s)"; else fail "Retry-After missing"; fi
RETRY_AFTER_MS="$(printf '%s' "$BODY" | sed -n 's/.*"retryAfterMs":\([0-9]*\).*/\1/p')"

heading "3. Consumers are isolated: bob is allowed while alice is blocked"
request /api/resource bob
expect_eq "status" "$STATUS" 200
expect_eq "RateLimit-Remaining" "$RL_REMAINING" $((LIMIT - 1))

heading "4. Recovery: after waiting retryAfterMs, alice is allowed again"
if [ -z "$RETRY_AFTER_MS" ]; then
  fail "no retryAfterMs in the 429 body; waiting a whole window instead"
  RETRY_AFTER_MS="$WINDOW_MS"
fi
WAIT_MS=$((((RETRY_AFTER_MS + 999) / 1000) * 1000 + 200)) # rounded up to whole seconds, plus a 200 ms margin
echo "  retryAfterMs is $RETRY_AFTER_MS: sleeping $WAIT_MS ms"
sleep_ms "$WAIT_MS"
request /api/resource alice
expect_eq "status" "$STATUS" 200

heading "5. Missing X-Consumer-Id: 400 (no quota used)"
request /api/resource
show_body
expect_eq "status" "$STATUS" 400

heading "6. /api/search has its own, stricter limit"
i=1
while [ "$i" -le "$SEARCH_LIMIT" ]; do
  request /api/search carol
  expect_eq "status" "$STATUS" 200
  expect_eq "RateLimit-Limit" "$RL_LIMIT" "$SEARCH_LIMIT"
  i=$((i + 1))
done
request /api/search carol
expect_eq "status" "$STATUS" 429

heading "7. The partner consumer has a higher limit"
request /api/resource partner-acme
expect_eq "status" "$STATUS" 200
expect_eq "RateLimit-Limit" "$RL_LIMIT" "$PARTNER_LIMIT"

heading "8. /api/report spreads upstream calls ($UPSTREAM_LIMIT per ${UPSTREAM_WINDOW_MS} ms) instead of failing"
BURST=4
report_burst burst "$BURST"
ok=0 fastest='' slowest=''
i=1
while [ "$i" -le "$BURST" ]; do
  result="$(burst_result "$TMP_DIR/burst-$i.result")"
  status="${result%% *}" ms="$(to_ms "${result#* }")"
  printf '  request %s: HTTP %s in %s ms\n' "$i" "$status" "$ms"
  if [ "$status" = 200 ]; then ok=$((ok + 1)); fi
  if [ -z "$fastest" ] || [ "$ms" -lt "$fastest" ]; then fastest="$ms"; fi
  if [ -z "$slowest" ] || [ "$ms" -gt "$slowest" ]; then slowest="$ms"; fi
  i=$((i + 1))
done
expect_eq "requests answered 200" "$ok" "$BURST"
# Calls beyond the upstream quota wait ~${UPSTREAM_WINDOW_MS} ms; assert a loose lower bound only.
if [ $((slowest - fastest)) -ge 500 ]; then
  pass "slowest - fastest = $((slowest - fastest)) ms (>= 500 ms: later calls waited for upstream slots)"
else
  fail "slowest - fastest = $((slowest - fastest)) ms, expected >= 500 ms"
fi

heading "9. /api/report answers 503 when the upstream wait would exceed ${UPSTREAM_MAX_WAIT_MS} ms"
# 6 at once: 2 upstream slots now and 2 more after ~1 s fit in the wait cap; the rest would wait ~2 s, so they get 503.
OVERLOAD=6
report_burst overload "$OVERLOAD"
ok=0 unavailable=0 retry_after=''
i=1
while [ "$i" -le "$OVERLOAD" ]; do
  result="$(burst_result "$TMP_DIR/overload-$i.result")"
  status="${result%% *}"
  printf '  request %s: HTTP %s\n' "$i" "$status"
  if [ "$status" = 200 ]; then ok=$((ok + 1)); fi
  if [ "$status" = 503 ]; then
    unavailable=$((unavailable + 1))
    retry_after="$(header_value "$TMP_DIR/overload-$i.headers" Retry-After)"
  fi
  i=$((i + 1))
done
if [ "$ok" -ge 1 ]; then pass "$ok answered 200 within the wait cap"; else fail "no request answered 200"; fi
if [ "$unavailable" -ge 1 ]; then pass "$unavailable answered 503"; else fail "no request answered 503"; fi
if [ -n "$retry_after" ]; then pass "503 has Retry-After ($retry_after s)"; else fail "503 without Retry-After"; fi
expect_eq "200 + 503 answers" $((ok + unavailable)) "$OVERLOAD"

if [ "$SELF_TEST_FAIL" = 1 ]; then
  heading "Self-test: a check that cannot pass (--self-test-fail)"
  request /health
  expect_eq "status" "$STATUS" 418
fi

# --- Summary ---
if [ "$FAILED" -eq 0 ]; then COLOUR="$GREEN"; else COLOUR="$RED"; fi
printf '\n%s%s%d passed, %d failed%s\n' "$BOLD" "$COLOUR" "$PASSED" "$FAILED" "$RESET"
[ "$FAILED" -eq 0 ] || exit 1
