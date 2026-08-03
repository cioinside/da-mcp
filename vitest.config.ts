import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/e2e/**/*.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks', // safer for native modules
    // Vitest 4: poolOptions removed; pool-scoped options are now top-level test.* options.
    // "parallel by default" is the default behaviour; per-test concurrency is controlled
    // by maxWorkers (omitted = use CPU count). Tests must be safe to run in parallel.
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/index.ts'],
    },
  },
})