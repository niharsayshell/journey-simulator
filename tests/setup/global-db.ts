import { execSync } from "node:child_process";
import path from "node:path";

/** Apply migrations to the dedicated test database before integration/e2e suites. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://journey:journey@127.0.0.1:5432/journey_test";
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, "../../packages/database"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
