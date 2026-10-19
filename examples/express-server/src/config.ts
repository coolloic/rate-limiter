import { z } from 'zod';

import { PolicyRulesJsonSchema } from './policiesConfig';

const ExampleConfigSchema = z.object({
  // 0 lets the OS pick a free port while binding; the startup log shows which one.
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  // Same names and rules as the library's env (src/config/env.ts).
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_POLICIES: PolicyRulesJsonSchema,
  // The upstream behind /api/report: its quota, and the longest a request may wait for an upstream slot.
  UPSTREAM_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(5),
  UPSTREAM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(1000),
  UPSTREAM_MAX_WAIT_MS: z.coerce.number().int().positive().default(2000),
});

export type ExampleConfig = z.infer<typeof ExampleConfigSchema>;

/** Pure: validates the given variables (the entry point passes `process.env`); throws listing every bad field. */
export function loadExampleConfig(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<ExampleConfig> {
  // Empty values (e.g. `PORT=` in .env) count as unset so defaults apply.
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = ExampleConfigSchema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid example configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}
