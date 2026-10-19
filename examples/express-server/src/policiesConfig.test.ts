import { describe, expect, it } from 'vitest';

import { DEMO_POLICY_RULES, PolicyRulesJsonSchema } from './policiesConfig';

const EMPTY = { resources: {}, consumers: {}, overrides: {} };

function issuesOf(json: string): string[] {
  const parsed = PolicyRulesJsonSchema.safeParse(json);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('PolicyRulesJsonSchema', () => {
  it('defaults to the demo rules when unset', () => {
    expect(PolicyRulesJsonSchema.parse(undefined)).toEqual(DEMO_POLICY_RULES);
  });

  it('returns a fresh copy of the demo rules each time', () => {
    const first = PolicyRulesJsonSchema.parse(undefined);
    first.resources.search = { limit: 999, windowMs: 1 };

    expect(PolicyRulesJsonSchema.parse(undefined)).toEqual(DEMO_POLICY_RULES);
    expect(DEMO_POLICY_RULES.resources.search).toEqual({ limit: 3, windowMs: 1000 });
  });

  it('the demo rules make /api/search and the partner differ from the default', () => {
    expect(DEMO_POLICY_RULES).toEqual({
      resources: { search: { limit: 3, windowMs: 1000 } },
      consumers: { 'partner-acme': { limit: 50, windowMs: 1000 } },
      overrides: { search: { 'partner-acme': { limit: 20, windowMs: 1000 } } },
    });
  });

  it('parses resources, consumers and overrides from JSON', () => {
    const json = JSON.stringify({
      resources: { search: { limit: 2, windowMs: 300 } },
      consumers: { bob: { limit: 8, windowMs: 300 } },
      overrides: { search: { bob: { limit: 4, windowMs: 300 } } },
    });

    expect(PolicyRulesJsonSchema.parse(json)).toEqual(JSON.parse(json));
  });

  it('treats a missing section as empty, so "{}" means no extra rules', () => {
    expect(PolicyRulesJsonSchema.parse('{}')).toEqual(EMPTY);
    expect(PolicyRulesJsonSchema.parse('{"consumers":{}}')).toEqual(EMPTY);
  });

  it('rejects text that is not JSON', () => {
    expect(issuesOf('{resources:')).toEqual([': must be valid JSON']);
  });

  it.each([
    ['resources.search.limit', '{"resources":{"search":{"limit":0,"windowMs":1000}}}'],
    ['consumers.bob.windowMs', '{"consumers":{"bob":{"limit":1,"windowMs":-5}}}'],
    ['overrides.search.bob.limit', '{"overrides":{"search":{"bob":{"limit":1.5,"windowMs":1}}}}'],
    ['resources.search.windowMs', '{"resources":{"search":{"limit":1}}}'],
    ['resources.search.limit', '{"resources":{"search":{"limit":"3","windowMs":1}}}'],
  ])('rejects a bad policy, naming %s', (path, json) => {
    const issues = issuesOf(json);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(new RegExp(`^${path.replaceAll('.', '\\.')}: `));
  });

  it.each([
    ['', '[]'],
    ['', '"x"'],
    ['', '{"resource":{}}'], // typo of "resources"
    ['resources.search', '{"resources":{"search":{"limit":1,"windowMs":1,"burst":2}}}'],
  ])('rejects a wrong shape at "%s"', (path, json) => {
    const issues = issuesOf(json);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.startsWith(`${path}: `)).toBe(true);
  });
});
