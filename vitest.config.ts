import { defineConfig } from "vitest/config";

const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://journey:journey@127.0.0.1:5432/journey_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/1",
  QUEUE_PREFIX: "jstest",
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  LOG_LEVEL: "silent",
};

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node", testTimeout: 30_000, env: testEnv },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/global-db.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
          poolOptions: { forks: { singleFork: true } },
          env: testEnv,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/global-db.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
          poolOptions: { forks: { singleFork: true } },
          env: testEnv,
        },
      },
    ],
  },
});
