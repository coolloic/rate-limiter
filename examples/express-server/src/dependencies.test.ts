import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const EXAMPLE_ONLY = ['express', '@types/express'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

// package.json is external input: collect the dependency names without trusting its shape.
function dependencyNames(packageJsonUrl: URL): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return [];
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const deps: unknown = Reflect.get(parsed, field);
    return typeof deps === 'object' && deps !== null ? Object.keys(deps) : [];
  });
}

describe('dependencies', () => {
  it('declares Express in the example', () => {
    const names = dependencyNames(new URL('../package.json', import.meta.url));
    expect(names).toEqual(expect.arrayContaining(EXAMPLE_ONLY));
  });

  it('declares everything as devDependencies (a local-run example, never installed for production)', () => {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const runtime: unknown =
      typeof parsed === 'object' && parsed !== null
        ? Reflect.get(parsed, 'dependencies')
        : undefined;
    expect(runtime).toBeUndefined();
  });

  it('keeps Express out of the library', () => {
    // The library's package.json sits one level above its resolved entry point (dist/index.js).
    const library = new URL('../package.json', import.meta.resolve('coding-challenge-loic-wong'));
    const names = dependencyNames(library);
    expect(names).toContain('zod'); // sanity check: this is the library's package.json
    for (const name of EXAMPLE_ONLY) expect(names).not.toContain(name);
  });
});
