import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

// Lints a snippet as if it were src/index.ts and returns the ids of the rules that fired.
// src/index.ts is used because it gets the main `src/**` rules with no directory overrides,
// and the type-aware project service only accepts files that exist.
async function ruleIds(code: string): Promise<readonly (string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: 'src/index.ts' });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

// Pay ESLint's cold start (config + TypeScript program) once, outside any single test's timeout.
beforeAll(async () => {
  await ruleIds('export {};\n');
}, 30_000);

describe('import order', () => {
  it('accepts builtin → external → @/ alias → sibling, separated by blank lines', async () => {
    const code = [
      "import { readFileSync } from 'node:fs';",
      '',
      "import { z } from 'zod';",
      '',
      "import { getConfig } from '@/config';",
      '',
      "import { parseEnv } from './env';",
      '',
      'export const all = [readFileSync, z, getConfig, parseEnv];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });

  it('rejects groups out of order', async () => {
    const code = [
      "import { parseEnv } from './env';",
      '',
      "import { z } from 'zod';",
      '',
      'export const all = [z, parseEnv];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toContain('import-x/order');
  });

  it('rejects a missing blank line between groups', async () => {
    const code = [
      "import { z } from 'zod';",
      "import { parseEnv } from './env';",
      '',
      'export const all = [z, parseEnv];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toContain('import-x/order');
  });

  it('rejects unsorted imports within a group', async () => {
    const code = [
      "import { z } from 'zod';",
      "import { ESLint } from 'eslint';",
      '',
      'export const all = [z, ESLint];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toContain('import-x/order');
  });

  it('rejects builtins without the node: protocol', async () => {
    const code = [
      "import { readFileSync } from 'fs';",
      '',
      'export const all = [readFileSync];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toContain('no-restricted-imports');
  });

  it('rejects duplicate imports of the same module', async () => {
    const code = [
      "import { parseEnv } from './env';",
      "import type { Env } from './env';",
      '',
      'export const all: [typeof parseEnv, Env | undefined] = [parseEnv, undefined];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toContain('import-x/no-duplicates');
  });

  it('rejects imports after other statements', async () => {
    const code = [
      "import { z } from 'zod';",
      '',
      'export const a = z;',
      "import { parseEnv } from './env';",
      '',
      'export const b = parseEnv;',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toContain('import-x/first');
  });
});

describe('import restrictions', () => {
  it.each([
    ["import { parseEnv } from '..';", 'parent-relative'],
    ["import { getConfig } from '@/config/config';", 'deep import past a barrel'],
    ["import { parseEnv } from './env.js';", 'file extension'],
  ])('rejects %s (%s)', async (statement) => {
    expect(await ruleIds(`${statement}\n\nexport const all = [];\n`)).toContain(
      'no-restricted-imports',
    );
  });
});
