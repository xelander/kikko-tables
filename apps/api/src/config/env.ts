import { z } from 'zod';
import { resolveDatabaseUrl } from './database-url.js';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates environment variables at startup (used by `ConfigModule.forRoot`).
 * Throws with a readable list of problems so the process fails fast.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const strings = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  let databaseUrl: string;
  try {
    databaseUrl = resolveDatabaseUrl(strings);
  } catch (error) {
    throw new Error(`Invalid environment: ${(error as Error).message}`, { cause: error });
  }
  const result = EnvSchema.safeParse({ ...strings, DATABASE_URL: databaseUrl });
  if (!result.success) {
    const details = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${details}`);
  }
  return result.data;
}
