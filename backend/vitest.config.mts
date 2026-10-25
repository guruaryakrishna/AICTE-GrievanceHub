import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
