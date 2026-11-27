import { describe, expect, it } from 'vitest';
import { DEV_DATABASE_URL } from './database-url.js';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies development defaults', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      DATABASE_URL: DEV_DATABASE_URL,
      APP_VERSION: '0.0.0-dev',
    });
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
