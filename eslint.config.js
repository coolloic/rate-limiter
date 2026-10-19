import { builtinModules } from 'node:module';

import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // examples/* are workspace packages with their own eslint.config.js: `pnpm lint` skips them
  // (`pnpm check:examples` lints them), while ESLint still applies their nearest config when a
  // file is passed explicitly, as lint-staged does.
  { ignores: ['node_modules', 'dist', 'coverage', '.claude/worktrees', 'examples'] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: { 'import-x': importX },
    settings: { 'import-x/internal-regex': '^@/' },
    rules: {
      // Import sequence: builtin → external → @/ alias → sibling, blank line between groups,
      // alphabetical within a group. Auto-fixable with `eslint --fix` (the pre-commit hook runs it).
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use an `as const` object + union type instead of enum.',
        },
        {
          selector: 'ExportAllDeclaration',
          message: 'Barrels use explicit named re-exports, not `export *`.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          // Builtins must use the `node:` protocol (`node:fs`, not `fs`).
          paths: builtinModules
            .filter((name) => !name.startsWith('node:'))
            .map((name) => ({ name, message: `Use 'node:${name}' (node: protocol).` })),
          patterns: [
            {
              group: ['..', '../**'],
              message: 'Use the `@/` alias instead of parent-relative imports.',
            },
            {
              group: ['@/*/*'],
              message: "Import from the directory's barrel (`@/<dir>`), not its internals.",
            },
            {
              regex: '^(\\.{1,2}|@)/.*\\.(c|m)?(j|t)sx?$',
              message: 'Imports are extensionless (Bundler resolution).',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read env vars only in src/config/. Inject config instead.',
        },
      ],
    },
  },
  {
    files: ['src/config/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  },
  // Must stay last: turns off stylistic rules that conflict with Prettier.
  prettier,
);
