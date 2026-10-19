import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve the `@/*` alias from tsconfig.json, so the alias is defined in one place.
  resolve: { tsconfigPaths: true },
  // Agent worktrees under .claude/worktrees/ hold full copies of the repo; never run their tests here.
  // Workspace packages under examples/ run their own tests (`pnpm check:examples`).
  test: { exclude: [...configDefaults.exclude, '.claude/worktrees/**', 'examples/**'] },
});
