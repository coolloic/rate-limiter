import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

type Child = ChildProcessByStdio<null, Readable, Readable>;

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
// Built once for the whole run by src/buildServer.globalSetup.ts.
const ENTRY = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const TIMEOUT_MS = 5_000;

let child: Child | undefined;

interface Started {
  readonly process: Child;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

// Runs the BUILT server. Its env holds only PORT and `env` (nothing inherited), so the run is
// deterministic; `process.execPath` is absolute, so no PATH is needed.
function startServer(port: string, env: Readonly<Record<string, string>> = {}): Started {
  const started = spawn(process.execPath, [ENTRY], {
    cwd: PACKAGE_DIR,
    env: { ...env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = started;
  let stdout = '';
  let stderr = '';
  started.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  started.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  return { process: started, stdout: () => stdout, stderr: () => stderr };
}

// Resolves with the exit code once the process has exited (and its output is flushed), or rejects
// if it is still running after TIMEOUT_MS.
async function exitCode(started: Child): Promise<number | null> {
  if (started.exitCode !== null) return started.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`process still running after ${String(TIMEOUT_MS)} ms`));
    }, TIMEOUT_MS);
    started.once('close', (code: number | null) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

interface Listening extends Started {
  readonly port: number;
  readonly url: (path: string) => string;
}

// Starts the BUILT server with PORT=0, so the OS picks a free port while binding it: no other process can take
// the port between choosing and binding it (the old "find a free port, then start" race). The port is read from the
// startup log. Fails fast, with the server's stderr, if the server exits first.
async function startListening(env: Readonly<Record<string, string>> = {}): Promise<Listening> {
  const server = startServer('0', env);
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const match = /Listening on http:\/\/localhost:(\d+)/.exec(server.stdout());
    if (match?.[1] !== undefined) {
      const port = Number(match[1]);
      return { ...server, port, url: (path) => `http://localhost:${String(port)}${path}` };
    }
    if (server.process.exitCode !== null) {
      throw new Error(
        `server exited with code ${String(server.process.exitCode)} before listening:\n${server.stderr()}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `server did not start listening within ${String(TIMEOUT_MS)} ms:\n${server.stderr()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Never leak a server process, whatever the test outcome.
afterEach(() => {
  if (child?.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  child = undefined;
});

describe('node dist/main.js', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'serves /health, logs its URL, and exits 0 on %s',
    async (signal) => {
      const server = await startListening();

      const response = await fetch(server.url('/health'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
      expect(server.port).toBeGreaterThan(0);

      server.process.kill(signal);
      expect(await exitCode(server.process)).toBe(0);
    },
    15_000,
  );

  it('rate-limits /api/resource with the limit from RATE_LIMIT_* variables', async () => {
    const server = await startListening({
      RATE_LIMIT_MAX_REQUESTS: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(server.url('/api/resource'), {
        headers: { 'X-Consumer-Id': 'alice' },
      });
      codes.push(response.status);
    }

    expect(codes).toEqual([200, 200, 429]);
  }, 15_000);

  it('applies the demo policies when RATE_LIMIT_POLICIES is unset', async () => {
    const server = await startListening();

    const limits: (string | null)[] = [];
    for (const [consumerId, path] of [
      ['alice', '/api/search'],
      ['partner-acme', '/api/search'],
      ['alice', '/api/resource'],
      ['partner-acme', '/api/resource'],
    ] as const) {
      const response = await fetch(server.url(path), {
        headers: { 'X-Consumer-Id': consumerId },
      });
      limits.push(response.headers.get('RateLimit-Limit'));
    }

    expect(limits).toEqual(['3', '20', '10', '50']);
  }, 15_000);

  it('#14 exits 1 naming the rule when RATE_LIMIT_POLICIES has a non-positive limit', async () => {
    const server = startServer('0', {
      RATE_LIMIT_POLICIES: '{"resources":{"search":{"limit":0,"windowMs":1000}}}',
    });

    expect(await exitCode(server.process)).toBe(1);
    expect(server.stderr()).toMatch(/RATE_LIMIT_POLICIES\.resources\.search\.limit: /);
  }, 15_000);

  it('serves /api/report through an upstream limited by the UPSTREAM_* variables', async () => {
    const server = await startListening({
      UPSTREAM_RATE_LIMIT_MAX_REQUESTS: '1',
      UPSTREAM_RATE_LIMIT_WINDOW_MS: '60000',
      UPSTREAM_MAX_WAIT_MS: '100',
    });

    const codes: number[] = [];
    for (const id of ['r1', 'r2']) {
      const response = await fetch(server.url(`/api/report/${id}`), {
        headers: { 'X-Consumer-Id': 'alice' },
      });
      codes.push(response.status);
    }

    expect(codes).toEqual([200, 503]);
  }, 15_000);

  it("fails fast with the server's stderr when the server exits before listening", async () => {
    const started = Date.now();

    await expect(startListening({ RATE_LIMIT_MAX_REQUESTS: '0' })).rejects.toThrow(
      /exited with code 1 before listening:\n[\s\S]*RATE_LIMIT_MAX_REQUESTS/,
    );
    expect(Date.now() - started).toBeLessThan(TIMEOUT_MS);
  });

  it('exits 1 with a readable error when PORT is invalid', async () => {
    const server = startServer('abc');

    expect(await exitCode(server.process)).toBe(1);
    expect(server.stderr()).toMatch(/Invalid example configuration:\n {2}- PORT: /);
  });
});
