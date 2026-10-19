import { describe, expect, it } from 'vitest';

import { DEFAULT_RESOURCE, type LimitPolicy } from '@/domain';
import { AppError, InvalidArgumentError } from '@/errors';

import { ConfigurablePolicyResolver, type PolicyRules } from './ConfigurablePolicyResolver';

const DEFAULT: LimitPolicy = { limit: 10, windowMs: 1000 };
const SEARCH: LimitPolicy = { limit: 5, windowMs: 1000 };
const VIP: LimitPolicy = { limit: 100, windowMs: 1000 };
const VIP_SEARCH: LimitPolicy = { limit: 50, windowMs: 1000 };

const resolver = new ConfigurablePolicyResolver({
  default: DEFAULT,
  resources: { search: SEARCH },
  consumers: { vip: VIP },
  overrides: { search: { vip: VIP_SEARCH } },
});

describe('ConfigurablePolicyResolver', () => {
  it.each([
    ['default when nothing matches', { consumerId: 'alice' }, DEFAULT],
    ['resource rule', { consumerId: 'alice', resource: 'search' }, SEARCH],
    ['consumer rule over the resource rule', { consumerId: 'vip', resource: 'upload' }, VIP],
    [
      'override over the consumer and resource rules',
      { consumerId: 'vip', resource: 'search' },
      VIP_SEARCH,
    ],
  ])('uses the %s', (_name, consumer, expected) => {
    expect(resolver.resolve(consumer)).toBe(expected);
  });

  it('uses the consumer rule when the override for this resource names another consumer', () => {
    const rules = new ConfigurablePolicyResolver({
      default: DEFAULT,
      resources: { search: SEARCH },
      consumers: { vip: VIP },
      overrides: { search: { bob: VIP_SEARCH } },
    });
    expect(rules.resolve({ consumerId: 'vip', resource: 'search' })).toBe(VIP);
  });

  it('does not leak an override into another resource', () => {
    const rules = new ConfigurablePolicyResolver({
      default: DEFAULT,
      resources: { upload: SEARCH },
      overrides: { search: { vip: VIP_SEARCH } },
    });
    expect(rules.resolve({ consumerId: 'vip', resource: 'upload' })).toBe(SEARCH);
    expect(rules.resolve({ consumerId: 'vip', resource: 'other' })).toBe(DEFAULT);
  });

  it(`treats a missing resource as "${DEFAULT_RESOURCE}"`, () => {
    const rules = new ConfigurablePolicyResolver({
      default: DEFAULT,
      resources: { [DEFAULT_RESOURCE]: SEARCH },
      overrides: { [DEFAULT_RESOURCE]: { vip: VIP_SEARCH } },
    });
    expect(rules.resolve({ consumerId: 'alice' })).toBe(SEARCH);
    expect(rules.resolve({ consumerId: 'vip' })).toBe(VIP_SEARCH);
  });

  it('falls back to the default when only the default is configured', () => {
    const rules = new ConfigurablePolicyResolver({ default: DEFAULT });
    expect(rules.resolve({ consumerId: 'vip', resource: 'search' })).toBe(DEFAULT);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'ignores inherited object properties for the id "%s"',
    (key) => {
      expect(resolver.resolve({ consumerId: key })).toBe(DEFAULT);
      expect(resolver.resolve({ consumerId: 'alice', resource: key })).toBe(DEFAULT);
      expect(resolver.resolve({ consumerId: key, resource: key })).toBe(DEFAULT);
      expect(resolver.resolve({ consumerId: key, resource: 'search' })).toBe(SEARCH);
    },
  );

  describe('policy validation', () => {
    const levels: readonly (readonly [string, (bad: LimitPolicy) => PolicyRules])[] = [
      ['default', (bad): PolicyRules => ({ default: bad })],
      [
        'resources.search',
        (bad): PolicyRules => ({ default: DEFAULT, resources: { upload: SEARCH, search: bad } }),
      ],
      [
        'consumers.acme',
        (bad): PolicyRules => ({ default: DEFAULT, consumers: { vip: VIP, acme: bad } }),
      ],
      [
        'overrides.search.acme',
        (bad): PolicyRules => ({
          default: DEFAULT,
          overrides: { search: { vip: VIP_SEARCH, acme: bad } },
        }),
      ],
    ];
    const fields = ['limit', 'windowMs'] as const;
    const badValues = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];

    const cases = levels.flatMap(([path, build]) =>
      fields.flatMap((field) =>
        badValues.map(
          (value) => [`${path}.${field}`, value, build({ ...DEFAULT, [field]: value })] as const,
        ),
      ),
    );

    it.each(cases)('rejects %s = %s', (fieldPath, value, rules) => {
      const construct = (): ConfigurablePolicyResolver => new ConfigurablePolicyResolver(rules);
      expect(construct).toThrow(InvalidArgumentError);
      expect(construct).toThrow(AppError);
      expect(construct).toThrow(`${fieldPath} must be a positive integer, got ${String(value)}`);
    });

    it('accepts the largest safe integer', () => {
      const max: LimitPolicy = {
        limit: Number.MAX_SAFE_INTEGER,
        windowMs: Number.MAX_SAFE_INTEGER,
      };
      expect(new ConfigurablePolicyResolver({ default: max }).resolve({ consumerId: 'a' })).toBe(
        max,
      );
    });

    it.each(['__proto__', 'constructor', 'a.b'])(
      'validates a rule under the own key "%s"',
      (key) => {
        const bad: LimitPolicy = { limit: 0, windowMs: 1000 };
        // A computed key defines an own property, even for "__proto__".
        expect(
          () => new ConfigurablePolicyResolver({ default: DEFAULT, consumers: { [key]: bad } }),
        ).toThrow(`consumers.${key}.limit must be a positive integer, got 0`);
        expect(
          () =>
            new ConfigurablePolicyResolver({
              default: DEFAULT,
              overrides: { [key]: { [key]: bad } },
            }),
        ).toThrow(`overrides.${key}.${key}.limit must be a positive integer, got 0`);
      },
    );

    // resolve() finds any own key (Object.hasOwn), so non-enumerable rules must be validated too.
    it.each([true, false])(
      'validates a rule defined with defineProperty (enumerable: %s)',
      (enumerable) => {
        const resources: Record<string, LimitPolicy> = {};
        Object.defineProperty(resources, '__proto__', {
          value: { limit: 10, windowMs: -1 },
          enumerable,
        });
        expect(() => new ConfigurablePolicyResolver({ default: DEFAULT, resources })).toThrow(
          'resources.__proto__.windowMs must be a positive integer, got -1',
        );
      },
    );
  });
});
