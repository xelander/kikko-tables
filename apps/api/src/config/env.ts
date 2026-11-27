import { z } from 'zod';
import { resolveDatabaseUrl } from './database-url.js';
import { resolveMediaDir } from './media-dir.js';

/** Development-only secrets: production must provide its own (validated below). */
const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me-0123456789abcdef';
const DEV_PIN_SECRET = 'dev-only-pin-secret-change-me-0123456789abcdef';

const booleano = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  /** Secret for signing staff access tokens (JWT, HS256). */
  JWT_SECRET: z.string().min(32),
  /** Secret for the HMAC of table PINs. Changing it invalidates the PINs of open tables. */
  PIN_HMAC_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /** Personal staff login (own phone): refresh token lifetime. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  /** User session on a shared restaurant device (a shift), renewed on every use. */
  SHARED_DEVICE_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(14),
  /** Set the `Secure` flag on cookies. Defaults to true in production. */
  COOKIE_SECURE: booleano,
  /** Express "trust proxy" setting, e.g. `1` behind Caddy. Unset: do not trust X-Forwarded-For. */
  TRUST_PROXY: z.string().optional(),
  /** Requests per minute per IP on public endpoints (PIN entry, login). */
  THROTTLE_PUBLIC_LIMIT: z.coerce.number().int().min(1).default(20),
  /** Requests per minute per client (device cookie, else IP) on every other endpoint. */
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(300),
  /** Directory of dish photos, served under /media. */
  MEDIA_DIR: z.string().min(1),
  /** How often the server looks for sessions past their maximum duration (seconds). 0 disables the check. */
  CONTROLLO_SCADENZE_SECONDI: z.coerce.number().int().min(0).max(3600).default(30),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

/**
 * Validates environment variables at startup (used by `ConfigModule.forRoot`).
 * Throws with a readable list of problems so the process fails fast.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const strings = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const production = strings['NODE_ENV'] === 'production';
  let databaseUrl: string;
  try {
    databaseUrl = resolveDatabaseUrl(strings);
  } catch (error) {
    throw new Error(`Invalid environment: ${(error as Error).message}`, { cause: error });
  }
  const missingSecrets = production ? ['JWT_SECRET', 'PIN_HMAC_SECRET'].filter((k) => !strings[k]) : [];
  if (missingSecrets.length > 0) {
    throw new Error(`Invalid environment: ${missingSecrets.join(', ')} required in production`);
  }
  const result = EnvSchema.safeParse({
    ...strings,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: strings['JWT_SECRET'] || DEV_JWT_SECRET,
    PIN_HMAC_SECRET: strings['PIN_HMAC_SECRET'] || DEV_PIN_SECRET,
    MEDIA_DIR: resolveMediaDir(strings),
  });
  if (!result.success) {
    const details = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${details}`);
  }
  return { ...result.data, COOKIE_SECURE: result.data.COOKIE_SECURE ?? production };
}
