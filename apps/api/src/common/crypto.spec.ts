import { describe, expect, it } from 'vitest';
import { generaPin, hmacPin, sha256, tokenCasuale, uguali } from './crypto.js';

describe('crypto helpers', () => {
  it('generates 4-digit PINs including leading zeros', () => {
    const pins = Array.from({ length: 2000 }, () => generaPin());
    expect(pins.every((p) => /^\d{4}$/.test(p))).toBe(true);
    expect(pins.some((p) => p.startsWith('0'))).toBe(true);
  });

  it('binds the PIN hash to the secret and to the session', () => {
    const base = hmacPin('s'.repeat(32), 'seduta-1', '1234');
    expect(hmacPin('s'.repeat(32), 'seduta-1', '1234')).toBe(base);
    expect(hmacPin('s'.repeat(32), 'seduta-2', '1234')).not.toBe(base);
    expect(hmacPin('t'.repeat(32), 'seduta-1', '1234')).not.toBe(base);
    expect(hmacPin('s'.repeat(32), 'seduta-1', '1235')).not.toBe(base);
  });

  it('compares digests in constant time and handles different lengths', () => {
    expect(uguali(sha256('a'), sha256('a'))).toBe(true);
    expect(uguali(sha256('a'), sha256('b'))).toBe(false);
    expect(uguali('abcd', sha256('a'))).toBe(false);
  });

  it('creates unique URL-safe tokens', () => {
    const t = tokenCasuale();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenCasuale()).not.toBe(t);
  });
});
