import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/restaurant_pos_test?schema=public';

// Make the URL visible to globalSetup (same process) as well as worker env below.
process.env.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret-at-least-sixteen-characters-long',
      LOG_LEVEL: 'silent',
    },
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Keep Prisma connections stable — one worker process owns the test DB.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 60_000,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
  },
});
