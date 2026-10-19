import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

// Lints a snippet as if it were `filePath` (default src/app.ts; the type-aware project service only
// accepts files that exist) and returns the ids of the rules that fired.
async function ruleIds(code: string, filePath = 'src/app.ts'): Promise<readonly (string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

// Pay ESLint's cold start (config + TypeScript program) once, outside any single test's timeout.
beforeAll(async () => {
  await ruleIds('export {};\n');
}, 30_000);

describe('library imports', () => {
  it('accepts the public package entry point', async () => {
    const code = [
      "import { createRateLimiter } from 'coding-challenge-loic-wong';",
      '',
      'export const all = [createRateLimiter];',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });

  it.each([
    ["import { rateLimit } from 'coding-challenge-loic-wong/src/rateLimit';", 'deep import'],
    ["import { rateLimit } from 'coding-challenge-loic-wong/dist/index.js';", 'deep import'],
    ["import { createRateLimiter } from '@/factories';", "the library's @/ alias"],
    ["import { rateLimit } from '../../../src/rateLimit';", 'path outside the package'],
    ["import { rateLimit } from '../../../src';", 'path outside the package'],
    ["import { rateLimit } from 'src/rateLimit';", 'a bare src/ path'],
  ])('rejects %s (%s)', async (statement) => {
    expect(await ruleIds(`${statement}\n\nexport const all = [];\n`)).toContain(
      'no-restricted-imports',
    );
  });
});

describe('process.env', () => {
  const code = 'export const port = process.env.PORT;\n';

  it.each(['src/app.ts', 'src/config.ts'])('is rejected in %s', async (filePath) => {
    expect(await ruleIds(code, filePath)).toContain('no-restricted-properties');
  });

  it('is allowed in the entry point src/main.ts', async () => {
    expect(await ruleIds(code, 'src/main.ts')).not.toContain('no-restricted-properties');
  });
});
