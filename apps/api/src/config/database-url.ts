/**
 * Database URL used by the local docker-compose setup.
 * Only applied outside production, so that `npm run dev` works without a `.env` file.
 */
export const DEV_DATABASE_URL = 'postgresql://kikko:kikko@localhost:5432/kikko';

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const url = env['DATABASE_URL'];
  if (url && url.trim() !== '') return url;
  if (env['NODE_ENV'] === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }
  return DEV_DATABASE_URL;
}
