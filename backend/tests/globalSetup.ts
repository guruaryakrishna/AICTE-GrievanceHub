import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

export const TEST_DATABASE_URL = 'file:./test.db';

/**
 * Recreate an isolated SQLite database for the test run. The development
 * database is never touched.
 */
export default async function globalSetup() {
  const dbPath = resolve(__dirname, '..', 'prisma', 'test.db');
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    const file = `${dbPath}${suffix}`;
    if (existsSync(file)) unlinkSync(file);
  }

  const prismaCli = resolve(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(
    process.execPath,
    [prismaCli, 'db', 'push', '--force-reset', '--skip-generate'],
    {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    },
  );
}
