import { parseEnv, type Env } from './env';

let cached: Readonly<Env> | undefined;

// Singleton (lazy): loads .env and validates on first call, so importing this module has no side effects.
export function getConfig(): Readonly<Env> {
  if (cached === undefined) {
    loadDotEnvIfPresent();
    cached = parseEnv(process.env);
  }
  return cached;
}

// Node's built-in loader; like dotenv, it never overrides variables that are already set.
function loadDotEnvIfPresent(): void {
  try {
    process.loadEnvFile();
  } catch (error: unknown) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    if (!missing) throw error;
  }
}
