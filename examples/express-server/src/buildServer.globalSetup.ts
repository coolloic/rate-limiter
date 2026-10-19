import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Vitest global setup: builds dist/main.js once with the package's own `build` script, before any test file runs,
 * so the E2E tests run exactly what `pnpm start` runs (and `vitest` works on its own). One build for the whole run:
 * test files run in parallel, and a per-file build would rewrite dist/main.js while another file is starting it.
 */
export async function setup(): Promise<void> {
  await promisify(execFile)('pnpm', ['run', 'build'], { cwd: PACKAGE_DIR });
}
