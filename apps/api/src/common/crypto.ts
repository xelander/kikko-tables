import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

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

/** 256-bit key for PIN encryption, derived from the PIN secret with its own label. */
function chiavePin(segreto: string): Buffer {
  return createHash('sha256').update(`kikko-pin-cifratura:${segreto}`).digest();
}

/**
 * Encrypts a table PIN so staff can always see it (AES-256-GCM, bound to the session id).
 * The HMAC stays the only thing used to check PINs; this copy is only for display to staff.
 */
export function cifraPin(segreto: string, sedutaId: string, pin: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chiavePin(segreto), iv);
  cipher.setAAD(Buffer.from(sedutaId));
  const testo = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), testo]).toString('base64url');
}

/** Returns the PIN, or null if the value is missing, tampered with or encrypted with another secret. */
export function decifraPin(segreto: string, sedutaId: string, valore: string | null): string | null {
  if (!valore) return null;
  try {
    const dati = Buffer.from(valore, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', chiavePin(segreto), dati.subarray(0, 12));
    decipher.setAAD(Buffer.from(sedutaId));
    decipher.setAuthTag(dati.subarray(12, 28));
    return Buffer.concat([decipher.update(dati.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
