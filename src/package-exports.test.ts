import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateDtsBundle } from 'dts-bundle-generator';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = fileURLToPath(new URL('..', import.meta.url));

// package.json and the generator config are external input: narrow only the fields this test uses.
const PackageJsonSchema = z.object({
  exports: z.unknown().optional(),
  files: z.unknown().optional(),
});

const DtsBundleConfigSchema = z.object({
  compilationOptions: z.object({ preferredConfigPath: z.string() }),
  entries: z.tuple([
    z.object({
      filePath: z.string(),
      outFile: z.string(),
      // The tool's default is `true`, which would also export internal helper types.
      output: z.object({ exportReferencedTypes: z.boolean().default(true) }).default({
        exportReferencedTypes: true,
      }),
    }),
  ]),
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

const packageJson = PackageJsonSchema.parse(readJson('package.json'));
const dtsConfig = DtsBundleConfigSchema.parse(readJson('dts-bundle-generator.config.json'));
const [dtsEntry] = dtsConfig.entries;

describe('package.json exposes the built library', () => {
  it('maps the root export to the bundled JS and type declarations', () => {
    // Compared as JSON because condition order matters: `types` must come first.
    expect(JSON.stringify(packageJson.exports)).toBe(
      JSON.stringify({ '.': { types: './dist/index.d.ts', import: './dist/index.js' } }),
    );
  });

  it('publishes only dist/', () => {
    expect(packageJson.files).toEqual(['dist']);
  });
});

// Generates the declaration bundle in memory from the same config `pnpm build` uses (no writes).
describe('bundled type declarations (dts-bundle-generator.config.json)', () => {
  let dts = '';

  beforeAll(() => {
    const [bundle] = generateDtsBundle(
      [{ filePath: resolve(root, dtsEntry.filePath), output: dtsEntry.output }],
      { preferredConfigPath: resolve(root, dtsConfig.compilationOptions.preferredConfigPath) },
    );
    dts = bundle ?? '';
  }, 60_000);

  it('bundles src/index.ts into the file package.json points at', () => {
    expect(resolve(root, dtsEntry.filePath)).toBe(resolve(root, 'src/index.ts'));
    expect(resolve(root, dtsEntry.outFile)).toBe(resolve(root, 'dist/index.d.ts'));
  });

  it('contains no @/ alias specifiers', () => {
    expect(dts).not.toMatch(/['"]@\//);
  });

  it('contains no relative imports of internal files', () => {
    expect(dts).not.toMatch(/(from|import\()\s*['"]\./);
  });

  it('declares the public API', () => {
    const exported = new Set(
      [
        ...dts.matchAll(
          /^export (?:declare )?(?:abstract )?(?:class|function|const|interface|type) (\w+)/gm,
        ),
      ].map(([, name]) => name),
    );
    for (const name of [
      'rateLimit',
      'createRateLimiter',
      'toRateLimitHeaders',
      'acquire',
      'withRateLimit',
      'RateLimiter',
      'RateLimitResult',
      'RateLimiterOptions',
      'AcquireOptions',
      'RateLimitError',
    ]) {
      expect(exported, name).toContain(name);
    }
  });

  it('does not export internal helper types that src/index.ts does not export', () => {
    expect(dts).not.toMatch(
      /^export (?:interface|type) (CommonOptions|RateLimitResultBase|PolicyMap)\b/m,
    );
  });
});
