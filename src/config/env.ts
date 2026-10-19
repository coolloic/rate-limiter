import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(1000),
});

export type Env = z.infer<typeof EnvSchema>;

// Pure: no process.env access, so tests can import it without side effects.
export function parseEnv(source: Readonly<Record<string, string | undefined>>): Readonly<Env> {
  // Empty values (e.g. `LOG_LEVEL=` in .env) count as unset so defaults apply.
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}
