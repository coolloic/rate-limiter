import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

// Bundles a one-line entry like `pnpm build` does and returns the source files that made it in.
// strict: `ignoreAnnotations` makes esbuild ignore `"sideEffects": false`, so a module is only dropped
// if it has no top-level code at all — the flag cannot hide a real side effect.
// non-strict: honours `"sideEffects": false`, exactly like a consumer's bundler.
async function bundledModules(
  entry: string,
  { strict = true }: { readonly strict?: boolean } = {},
): Promise<readonly string[]> {
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    absWorkingDir: root,
    tsconfig: 'tsconfig.json',
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    ignoreAnnotations: strict,
    metafile: true,
    logLevel: 'silent',
  });
  // Only the output's contributing inputs count; metafile.inputs also lists modules that were dropped.
  return Object.values(result.metafile.outputs).flatMap((output) => Object.keys(output.inputs));
}

describe('tree-shaking through barrels', () => {
  it('drops the config loader when only parseEnv is imported from the barrel', async () => {
    const modules = await bundledModules(
      `import { parseEnv } from '@/config'; console.log(parseEnv);`,
    );
    expect(modules).toContain('src/config/env.ts');
    expect(modules).not.toContain('src/config/config.ts');
  });

  it('keeps the config loader when getConfig is used (control)', async () => {
    const modules = await bundledModules(
      `import { getConfig } from '@/config'; console.log(getConfig);`,
    );
    expect(modules).toContain('src/config/config.ts');
  });

  it('drops every module of a barrel when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/config';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });
});

describe('tree-shaking through the errors barrel', () => {
  it('drops every module of the errors barrel when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/errors';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('bundles only the used error and its base classes', async () => {
    const modules = await bundledModules(
      `import { RateLimitError } from '@/errors'; console.log(RateLimitError);`,
      { strict: false },
    );
    expect(modules).toContain('src/errors/RateLimitError.ts');
    expect(modules).toContain('src/errors/AppError.ts');
    expect(modules).not.toContain('src/errors/RateLimitTimeoutError.ts');
  });
});

describe('tree-shaking: rate limiter core barrels', () => {
  it('drops SystemClock when only DEFAULT_RESOURCE is imported from @/domain', async () => {
    const modules = await bundledModules(
      `import { DEFAULT_RESOURCE } from '@/domain'; console.log(DEFAULT_RESOURCE);`,
    );
    expect(modules).toContain('src/domain/types.ts');
    expect(modules).not.toContain('src/domain/SystemClock.ts');
  });

  it.each(['@/domain', '@/testing'])(
    'drops every module of %s when nothing from it is used',
    async (barrel) => {
      const modules = await bundledModules(`import '${barrel}';`, { strict: false });
      expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
    },
  );

  it('bundles nothing from the type-only @/interfaces barrel', async () => {
    const modules = await bundledModules(`import '@/interfaces';`);
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });
});

describe('tree-shaking through the http barrel', () => {
  it('drops every module of @/http when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/http';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('bundles headers.ts but nothing from @/domain (type-only import)', async () => {
    const modules = await bundledModules(
      `import { toRateLimitHeaders } from '@/http'; console.log(toRateLimitHeaders);`,
    );
    expect(modules).toContain('src/http/headers.ts');
    expect(modules.filter((file) => file.startsWith('src/domain/'))).toEqual([]);
  });
});

describe('tree-shaking: RateLimiter', () => {
  it('drops RateLimiter when only DEFAULT_RESOURCE is imported from @/domain', async () => {
    const modules = await bundledModules(
      `import { DEFAULT_RESOURCE } from '@/domain'; console.log(DEFAULT_RESOURCE);`,
    );
    expect(modules).toContain('src/domain/types.ts');
    expect(modules).not.toContain('src/domain/RateLimiter.ts');
  });

  it('keeps RateLimiter when it is used (control)', async () => {
    const modules = await bundledModules(
      `import { RateLimiter } from '@/domain'; console.log(RateLimiter);`,
    );
    expect(modules).toContain('src/domain/RateLimiter.ts');
  });
});

describe('tree-shaking through the stores barrel', () => {
  it('drops every module of @/stores when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/stores';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('bundles InMemoryStore when it is used (control)', async () => {
    const modules = await bundledModules(
      `import { InMemoryStore } from '@/stores'; console.log(InMemoryStore);`,
    );
    expect(modules).toContain('src/stores/InMemoryStore.ts');
  });
});

describe('tree-shaking: policies barrel', () => {
  it('drops every module of @/policies when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/policies';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('bundles the resolver and only the domain module it uses (control)', async () => {
    const modules = await bundledModules(
      `import { ConfigurablePolicyResolver } from '@/policies'; console.log(ConfigurablePolicyResolver);`,
      { strict: false },
    );
    expect(modules).toContain('src/policies/ConfigurablePolicyResolver.ts');
    expect(modules).toContain('src/domain/types.ts');
    expect(modules).not.toContain('src/domain/SystemClock.ts');
  });
});

describe('tree-shaking: strategies barrel', () => {
  it('drops every module of @/strategies when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/strategies';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('bundles SlidingWindowLogStrategy but no store or domain module (control)', async () => {
    const modules = await bundledModules(
      `import { SlidingWindowLogStrategy } from '@/strategies'; console.log(SlidingWindowLogStrategy);`,
    );
    expect(modules).toContain('src/strategies/SlidingWindowLogStrategy.ts');
    expect(modules.filter((file) => /^src\/(stores|domain)\//.test(file))).toEqual([]);
  });
});

describe('tree-shaking: client barrel', () => {
  it('drops every module of @/client when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/client';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('bundles acquire and its error, but nothing from @/domain (type-only import)', async () => {
    const modules = await bundledModules(
      `import { acquire } from '@/client'; console.log(acquire);`,
      { strict: false },
    );
    expect(modules).toContain('src/client/acquire.ts');
    expect(modules).toContain('src/errors/RateLimitTimeoutError.ts');
    expect(modules.filter((file) => file.startsWith('src/domain/'))).toEqual([]);
  });
});

describe('tree-shaking: withRateLimit', () => {
  it('bundles withRateLimit with acquire, but nothing from @/domain (type-only import)', async () => {
    const modules = await bundledModules(
      `import { withRateLimit } from '@/client'; console.log(withRateLimit);`,
      { strict: false },
    );
    expect(modules).toContain('src/client/withRateLimit.ts');
    expect(modules).toContain('src/client/acquire.ts');
    expect(modules.filter((file) => file.startsWith('src/domain/'))).toEqual([]);
  });

  it('drops withRateLimit when only acquire is used', async () => {
    const modules = await bundledModules(
      `import { acquire } from '@/client'; console.log(acquire);`,
      { strict: false },
    );
    expect(modules).not.toContain('src/client/withRateLimit.ts');
  });
});

describe('tree-shaking: factories barrel and public API', () => {
  it('drops every module of @/factories when nothing from it is used', async () => {
    const modules = await bundledModules(`import '@/factories';`, { strict: false });
    expect(modules.filter((file) => file.startsWith('src/'))).toEqual([]);
  });

  it('drops the lazy rateLimit singleton module when something else is imported from the root', async () => {
    const modules = await bundledModules(
      `import { createRateLimiter } from './src/index'; console.log(createRateLimiter);`,
    );
    expect(modules).toContain('src/factories/createRateLimiter.ts');
    expect(modules).not.toContain('src/rateLimit.ts');
  });

  it('keeps the rateLimit module when rateLimit is used (control)', async () => {
    const modules = await bundledModules(
      `import { rateLimit } from './src/index'; console.log(rateLimit);`,
    );
    expect(modules).toContain('src/rateLimit.ts');
  });

  it('bundles only headers.ts when only toRateLimitHeaders is imported from the root', async () => {
    const modules = await bundledModules(
      `import { toRateLimitHeaders } from './src/index'; console.log(toRateLimitHeaders);`,
      { strict: false },
    );
    // Barrels contain only re-exports, so they add no code; every other module must be dropped.
    const code = modules.filter((file) => file.startsWith('src/') && !file.endsWith('index.ts'));
    expect(code).toEqual(['src/http/headers.ts']);
  });
});
