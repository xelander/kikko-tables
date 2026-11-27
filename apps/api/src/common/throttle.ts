import { Throttle } from '@nestjs/throttler';

/**
 * Stricter rate limit for public endpoints (PIN entry, login).
 * The limit is validated at startup (THROTTLE_PUBLIC_LIMIT) and read lazily here.
 */
export const LimitePubblico = () =>
  Throttle({ default: { limit: () => Number(process.env['THROTTLE_PUBLIC_LIMIT'] ?? 20), ttl: 60_000 } });
