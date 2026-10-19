import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Builds dist/main.js once for the E2E tests that run the built server.
    globalSetup: ['src/buildServer.globalSetup.ts'],
  },
});
