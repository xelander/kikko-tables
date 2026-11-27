import type { CookieOptions, Response } from 'express';

export const COOKIE = {
  /** Staff refresh token (rotated on every use). */
  refresh: 'kk_rt',
  /** Shared restaurant device credential (long-lived). */
  dispositivoStaff: 'kk_dev',
  /** Customer device token, bound to a session. */
  cliente: 'kk_ct',
  /** Anonymous device id used to count wrong PINs per device. */
  idDispositivo: 'kk_did',
} as const;

export const PATH_AUTH = '/api/auth';

export function opzioniCookie(secure: boolean, path: string, maxAgeMs: number): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path, maxAge: maxAgeMs };
}

export function cancellaCookie(res: Response, nome: string, secure: boolean, path: string): void {
  res.clearCookie(nome, { httpOnly: true, secure, sameSite: 'strict', path });
}

/** Reads a cookie set by cookie-parser, ignoring anything that is not a non-empty string. */
export function leggiCookie(cookies: unknown, nome: string): string | null {
  if (!cookies || typeof cookies !== 'object') return null;
  const valore = (cookies as Record<string, unknown>)[nome];
  return typeof valore === 'string' && valore.length > 0 && valore.length <= 200 ? valore : null;
}

export const GIORNO_MS = 24 * 60 * 60_000;
