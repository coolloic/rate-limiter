import { z } from 'zod';

// Same rule as the library's ConfigurablePolicyResolver: positive (safe) integers.
const PolicySchema = z.strictObject({
  limit: z.number().int().positive(),
  windowMs: z.number().int().positive(),
});
const PolicyMapSchema = z.record(z.string(), PolicySchema);

/** The library's `PolicyRules` minus `default` (that comes from `RATE_LIMIT_MAX_REQUESTS`/`_WINDOW_MS`). */
const PolicyRulesSchema = z.strictObject({
  resources: PolicyMapSchema.default({}),
  consumers: PolicyMapSchema.default({}),
  overrides: z.record(z.string(), PolicyMapSchema).default({}),
});

export type ExamplePolicyRules = z.infer<typeof PolicyRulesSchema>;

/** Demo rules used when `RATE_LIMIT_POLICIES` is unset, so `/api/search` and the partner differ visibly. */
export const DEMO_POLICY_RULES: ExamplePolicyRules = {
  resources: { search: { limit: 3, windowMs: 1000 } },
  consumers: { 'partner-acme': { limit: 50, windowMs: 1000 } },
  overrides: { search: { 'partner-acme': { limit: 20, windowMs: 1000 } } },
};

/** `RATE_LIMIT_POLICIES`: a JSON string, parsed then validated; issues carry the rule path. */
export const PolicyRulesJsonSchema = z
  .string()
  .transform((text, ctx): unknown => {
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      ctx.issues.push({ code: 'custom', message: 'must be valid JSON', input: text });
      return z.NEVER;
    }
  })
  .pipe(PolicyRulesSchema)
  // A fresh copy per parse, so no caller can change the shared demo rules.
  .default(() => structuredClone(DEMO_POLICY_RULES));
