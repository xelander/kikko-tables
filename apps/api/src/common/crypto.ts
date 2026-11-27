import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Random URL-safe token (256 bits by default), used for cookies. */
export function tokenCasuale(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Tokens are high-entropy, so a fast hash is enough to store them. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Random numeric PIN with leading zeros, uniformly distributed. */
export function generaPin(cifre = 4): string {
  return String(randomInt(0, 10 ** cifre)).padStart(cifre, '0');
}

/**
 * HMAC of a table PIN, bound to its session so the same PIN on two sessions hashes differently.
 * A 4-digit PIN has only 10 000 values: without the server secret the hash cannot be brute forced offline.
 */
export function hmacPin(segreto: string, sedutaId: string, pin: string): string {
  return createHmac('sha256', segreto).update(`${sedutaId}:${pin}`).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function uguali(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
