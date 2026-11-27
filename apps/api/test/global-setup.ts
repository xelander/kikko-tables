import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Creates the integration test database if missing and applies all migrations.
 * The database name comes from TEST_DATABASE_URL (default `kikko_test`), never from DATABASE_URL,
 * so tests cannot touch the development data.
 */
export default async function setup(): Promise<void> {
  const url = new URL(process.env['TEST_DATABASE_URL'] ?? 'postgresql://kikko:kikko@localhost:5432/kikko_test');
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`Refusing to run tests on "${dbName}": the test database name must end with "_test"`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
}
