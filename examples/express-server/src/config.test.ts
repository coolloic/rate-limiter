import { describe, expect, it } from 'vitest';

import { loadExampleConfig } from './config';
import { DEMO_POLICY_RULES } from './policiesConfig';

const UPSTREAM_DEFAULTS = {
  UPSTREAM_RATE_LIMIT_MAX_REQUESTS: 5,
  UPSTREAM_RATE_LIMIT_WINDOW_MS: 1000,
  UPSTREAM_MAX_WAIT_MS: 2000,
};

describe('loadExampleConfig', () => {
  it('defaults PORT to 3000, the limit to 10 requests per 1000 ms, and the upstream to 5 per 1000 ms with a 2000 ms cap', () => {
    expect(loadExampleConfig({})).toEqual({
      PORT: 3000,
      RATE_LIMIT_MAX_REQUESTS: 10,
      RATE_LIMIT_WINDOW_MS: 1000,
      RATE_LIMIT_POLICIES: DEMO_POLICY_RULES,
      ...UPSTREAM_DEFAULTS,
    });
  });

  it('reads the upstream limit, window and cap as numbers', () => {
    const config = loadExampleConfig({
      UPSTREAM_RATE_LIMIT_MAX_REQUESTS: '3',
      UPSTREAM_RATE_LIMIT_WINDOW_MS: '300',
      UPSTREAM_MAX_WAIT_MS: '100',
    });
    expect(config).toMatchObject({
      UPSTREAM_RATE_LIMIT_MAX_REQUESTS: 3,
      UPSTREAM_RATE_LIMIT_WINDOW_MS: 300,
      UPSTREAM_MAX_WAIT_MS: 100,
    });
  });

  it('treats empty upstream variables as unset', () => {
    const config = loadExampleConfig({
      UPSTREAM_RATE_LIMIT_MAX_REQUESTS: '',
      UPSTREAM_RATE_LIMIT_WINDOW_MS: '',
      UPSTREAM_MAX_WAIT_MS: '',
    });
    expect(config).toMatchObject(UPSTREAM_DEFAULTS);
  });

  it('reads the limit and window as numbers', () => {
    const config = loadExampleConfig({ RATE_LIMIT_MAX_REQUESTS: '5', RATE_LIMIT_WINDOW_MS: '300' });
    expect(config).toMatchObject({ RATE_LIMIT_MAX_REQUESTS: 5, RATE_LIMIT_WINDOW_MS: 300 });
  });

  it('treats empty limit variables as unset', () => {
    const config = loadExampleConfig({ RATE_LIMIT_MAX_REQUESTS: '', RATE_LIMIT_WINDOW_MS: '' });
    expect(config).toMatchObject({ RATE_LIMIT_MAX_REQUESTS: 10, RATE_LIMIT_WINDOW_MS: 1000 });
  });

  it.each([
    'RATE_LIMIT_MAX_REQUESTS',
    'RATE_LIMIT_WINDOW_MS',
    'UPSTREAM_RATE_LIMIT_MAX_REQUESTS',
    'UPSTREAM_RATE_LIMIT_WINDOW_MS',
    'UPSTREAM_MAX_WAIT_MS',
  ])('rejects a non-positive-integer %s, naming the field', (name) => {
    for (const value of ['0', '-1', '1.5', 'abc']) {
      expect(() => loadExampleConfig({ [name]: value })).toThrow(
        new RegExp(`^Invalid example configuration:\\n {2}- ${name}: `),
      );
    }
  });

  it('lists every bad field', () => {
    expect(() =>
      loadExampleConfig({ PORT: 'x', RATE_LIMIT_MAX_REQUESTS: '0', RATE_LIMIT_WINDOW_MS: '0' }),
    ).toThrow(/PORT: [^\n]*\n {2}- RATE_LIMIT_MAX_REQUESTS: [^\n]*\n {2}- RATE_LIMIT_WINDOW_MS: /);
  });

  it('reads a valid PORT as a number', () => {
    expect(loadExampleConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('accepts the boundary ports 1 and 65535', () => {
    expect(loadExampleConfig({ PORT: '1' }).PORT).toBe(1);
    expect(loadExampleConfig({ PORT: '65535' }).PORT).toBe(65535);
  });

  it('accepts PORT=0, which lets the OS pick a free port', () => {
    expect(loadExampleConfig({ PORT: '0' }).PORT).toBe(0);
  });

  it('treats an empty PORT as unset', () => {
    expect(loadExampleConfig({ PORT: '' }).PORT).toBe(3000);
  });

  it('ignores unrelated variables and returns a frozen object', () => {
    const config = loadExampleConfig({ PORT: '8080', HOME: '/home/me' });
    expect(config).toEqual({
      PORT: 8080,
      RATE_LIMIT_MAX_REQUESTS: 10,
      RATE_LIMIT_WINDOW_MS: 1000,
      RATE_LIMIT_POLICIES: DEMO_POLICY_RULES,
      ...UPSTREAM_DEFAULTS,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each(['70000', 'abc', '1.5', '-1'])('rejects PORT=%s, naming the field', (port) => {
    expect(() => loadExampleConfig({ PORT: port })).toThrow(
      /^Invalid example configuration:\n {2}- PORT: /,
    );
  });

  it('reads RATE_LIMIT_POLICIES as JSON rules; empty means the demo rules', () => {
    const rules = { resources: { search: { limit: 2, windowMs: 300 } } };
    expect(
      loadExampleConfig({ RATE_LIMIT_POLICIES: JSON.stringify(rules) }).RATE_LIMIT_POLICIES,
    ).toEqual({ ...rules, consumers: {}, overrides: {} });
    expect(loadExampleConfig({ RATE_LIMIT_POLICIES: '' }).RATE_LIMIT_POLICIES).toEqual(
      DEMO_POLICY_RULES,
    );
  });

  it('rejects bad RATE_LIMIT_POLICIES, naming the rule path', () => {
    expect(() =>
      loadExampleConfig({
        RATE_LIMIT_POLICIES: '{"resources":{"search":{"limit":0,"windowMs":1000}}}',
      }),
    ).toThrow(
      /^Invalid example configuration:\n {2}- RATE_LIMIT_POLICIES\.resources\.search\.limit: /,
    );
    expect(() => loadExampleConfig({ RATE_LIMIT_POLICIES: 'not json' })).toThrow(
      /^Invalid example configuration:\n {2}- RATE_LIMIT_POLICIES: must be valid JSON/,
    );
  });
});
