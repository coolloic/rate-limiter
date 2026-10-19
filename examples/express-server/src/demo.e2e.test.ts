import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The demo runs the BUILT server (dist/main.js), built once for the whole run by src/buildServer.globalSetup.ts.
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
// The demo sleeps through a rate-limit window and an upstream burst: a few seconds, with headroom.
const DEMO_TIMEOUT_MS = 30_000;

// The demo needs only bash and curl (plus the node that runs this test); skip where either is missing.
const hasBashAndCurl =
  spawnSync('bash', ['-c', 'command -v curl'], { stdio: 'ignore' }).status === 0;

interface DemoRun {
  readonly code: number | null;
  readonly output: string;
}

// Runs the demo to completion (it inherits this process's env and PATH, as a developer's shell would).
async function runDemo(args: readonly string[] = []): Promise<DemoRun> {
  const demo = spawn('bash', ['scripts/demo.sh', ...args], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  demo.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  demo.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  const code = await new Promise<number | null>((resolve) => {
    demo.once('close', resolve);
  });
  return { code, output };
}

// The port the demo printed when it started its server (the last one: it retries if a port was taken meanwhile).
function demoPort(output: string): string {
  const port = [...output.matchAll(/Starting the server on port (\d+)/g)].at(-1)?.[1];
  if (port === undefined) throw new Error(`No port in the demo output:\n${output}`);
  return port;
}

// True when nothing answers on the port any more, i.e. the demo stopped its server.
async function nothingListensOn(port: string): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/health`);
    return false;
  } catch {
    return true;
  }
}

// Concurrent: each run picks its own free port, and both spend most of their time sleeping.
describe.skipIf(!hasBashAndCurl)('scripts/demo.sh', () => {
  it.concurrent(
    'passes every scenario, exits 0, and stops its server',
    async () => {
      const { code, output } = await runDemo();

      expect(code, output).toBe(0);
      expect(output).toMatch(/\b\d+ passed, 0 failed\b/);
      expect(output).not.toMatch(/\bFAIL\b/);
      expect(await nothingListensOn(demoPort(output))).toBe(true);
    },
    DEMO_TIMEOUT_MS,
  );

  // `--self-test-fail` adds one check that cannot pass, to prove the failure path without breaking the server.
  it.concurrent(
    'exits non-zero when a check fails, and still stops its server',
    async () => {
      const { code, output } = await runDemo(['--self-test-fail']);

      expect(code, output).toBe(1);
      expect(output).toMatch(/\b\d+ passed, 1 failed\b/);
      expect(await nothingListensOn(demoPort(output))).toBe(true);
    },
    DEMO_TIMEOUT_MS,
  );
});
