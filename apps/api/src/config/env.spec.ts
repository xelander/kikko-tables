import { describe, expect, it } from 'vitest';
import { DEV_DATABASE_URL } from './database-url.js';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies development defaults', () => {
    expect(validateEnv({})).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      DATABASE_URL: DEV_DATABASE_URL,
      APP_VERSION: '0.0.0-dev',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 90,
      SHARED_DEVICE_SESSION_TTL_HOURS: 14,
      COOKIE_SECURE: false,
    });
    expect(validateEnv({}).MEDIA_DIR).toMatch(/media$/);
    expect(validateEnv({ MEDIA_DIR: '/srv/media' }).MEDIA_DIR).toBe('/srv/media');
    expect(validateEnv({}).JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('requires real secrets in production and secure cookies by default', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@h/db' };
    expect(() => validateEnv(base)).toThrow(/JWT_SECRET, PIN_HMAC_SECRET required in production/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short', PIN_HMAC_SECRET: 'x'.repeat(32) })).toThrow(/JWT_SECRET/);
    const env = validateEnv({ ...base, JWT_SECRET: 'j'.repeat(32), PIN_HMAC_SECRET: 'p'.repeat(32) });
    expect(env.COOKIE_SECURE).toBe(true);
    expect(
      validateEnv({ ...base, JWT_SECRET: 'j'.repeat(32), PIN_HMAC_SECRET: 'p'.repeat(32), COOKIE_SECURE: 'false' })
        .COOKIE_SECURE,
    ).toBe(false);
  });

  it('coerces PORT from string', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL is required/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid port and unknown NODE_ENV', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
