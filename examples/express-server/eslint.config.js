import { builtinModules } from 'node:module';

import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

// Same rule set as the library's root config, minus the `@/` alias (this package has none),
// plus a guard that the library is used only through its public package entry point.
export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage'] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: { 'import-x': importX },
    rules: {
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
          message: 'Use explicit named re-exports, not `export *`.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules
            .filter((name) => !name.startsWith('node:'))
            .map((name) => ({ name, message: `Use 'node:${name}' (node: protocol).` })),
          patterns: [
            {
              regex: '^coding-challenge-loic-wong/',
              message: "Import the library from 'coding-challenge-loic-wong' only (public API).",
            },
            {
              regex: '^@/',
              message: "The library's `@/` alias is internal; import 'coding-challenge-loic-wong'.",
            },
            {
              regex: '^\\.\\./\\.\\.(/|$)',
              message: 'Do not import from outside this package; use its dependencies.',
            },
            {
              regex: '^(?!\\.)(.*/)?src(/|$)',
              message: "Do not import a package's `src/`; import 'coding-challenge-loic-wong'.",
            },
            {
              regex: '^\\.{1,2}/.*\\.(c|m)?(j|t)sx?$',
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
          message: 'Read env vars only in the entry point / config module. Inject config instead.',
        },
      ],
    },
  },
  // The entry point is the one file that reads env vars; it passes them to the pure config loader.
  {
    files: ['src/main.ts'],
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
