import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { COOKIE, leggiCookie } from './cookies.js';
import { sha256 } from './crypto.js';

/**
 * Rate limits per device rather than per IP when possible: in the restaurant every customer
 * goes out through the same Wi-Fi address, so an IP-based limit would throttle the whole room.
 * Customers are tracked by their device cookies; everyone else by IP.
 */
@Injectable()
export class DispositivoThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const cookies = req['cookies'];
    const token = leggiCookie(cookies, COOKIE.cliente) ?? leggiCookie(cookies, COOKIE.idDispositivo);
    if (token) return `dispositivo:${sha256(token).slice(0, 32)}`;
    return `ip:${String(req['ip'] ?? 'sconosciuto')}`;
  }
}
