import { execSync } from 'node:child_process';

// Runs once before the whole test run: apply migrations to the test database.
// `prisma migrate deploy` is idempotent — re-running on an already-migrated
// schema is a no-op.
export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set for tests');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
