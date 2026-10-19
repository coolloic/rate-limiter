import { DEFAULT_RESOURCE, type Consumer, type LimitPolicy } from '@/domain';
import { InvalidArgumentError } from '@/errors';
import type { PolicyResolver } from '@/interfaces';

type PolicyMap = Readonly<Record<string, LimitPolicy>>;

/** Limit rules, from least to most specific. */
export interface PolicyRules {
  readonly default: LimitPolicy;
  /** Per resource, for every consumer. */
  readonly resources?: PolicyMap;
  /** Per consumer, on every resource. */
  readonly consumers?: PolicyMap;
  /** Per resource, then per consumer. */
  readonly overrides?: Readonly<Record<string, PolicyMap>>;
}

/**
 * Most specific rule wins: override (resource + consumer) → consumer → resource → default.
 * Every rule is validated on construction (fail fast), so `resolve` never returns a bad policy.
 */
export class ConfigurablePolicyResolver implements PolicyResolver {
  /** @throws InvalidArgumentError if any rule's `limit` or `windowMs` is not a positive safe integer. */
  public constructor(private readonly rules: PolicyRules) {
    assertValidPolicy(rules.default, 'default');
    assertValidPolicies(rules.resources, 'resources');
    assertValidPolicies(rules.consumers, 'consumers');
    for (const resource of Object.getOwnPropertyNames(rules.overrides ?? {})) {
      assertValidPolicies(ownValue(rules.overrides, resource), `overrides.${resource}`);
    }
  }

  public resolve({ consumerId, resource = DEFAULT_RESOURCE }: Consumer): LimitPolicy {
    const { overrides, consumers, resources } = this.rules;
    return (
      ownValue(ownValue(overrides, resource), consumerId) ??
      ownValue(consumers, consumerId) ??
      ownValue(resources, resource) ??
      this.rules.default
    );
  }
}

/** Own-property lookup, so IDs such as "toString" or "__proto__" never hit Object.prototype. */
function ownValue<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Every own string key, enumerable or not, because `resolve` finds them all via `Object.hasOwn`.
 * Inherited keys are skipped, like in `resolve`; an own "__proto__" key is still checked.
 */
function assertValidPolicies(policies: PolicyMap | undefined, path: string): void {
  for (const key of Object.getOwnPropertyNames(policies ?? {})) {
    const policy = ownValue(policies, key);
    if (policy !== undefined) assertValidPolicy(policy, `${path}.${key}`);
  }
}

function assertValidPolicy(policy: LimitPolicy, path: string): void {
  for (const field of ['limit', 'windowMs'] as const) {
    const value = policy[field];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new InvalidArgumentError(
        `${path}.${field} must be a positive integer, got ${String(value)}`,
      );
    }
  }
}
