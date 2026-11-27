import { describe, expect, it } from 'vitest';
import {
  BLOCCO_MAX_MS,
  STATO_INIZIALE,
  type StatoBlocco,
  durataBloccoMs,
  registraFallimento,
  secondiBlocco,
  tentativiRimasti,
} from './blocco.js';

const t0 = new Date('2026-11-27T20:00:00Z');
const dopo = (ms: number) => new Date(t0.getTime() + ms);

function falliscePerVolte(n: number, stato: StatoBlocco = STATO_INIZIALE, ora = t0): StatoBlocco {
  let s = stato;
  for (let i = 0; i < n; i++) s = registraFallimento(s, ora);
  return s;
}

describe('PIN lockout', () => {
  it('allows 5 wrong attempts, then locks for 60 seconds', () => {
    const quattro = falliscePerVolte(4);
    expect(secondiBlocco(quattro, t0)).toBe(0);
    expect(tentativiRimasti(quattro)).toBe(1);

    const cinque = registraFallimento(quattro, t0);
    expect(secondiBlocco(cinque, t0)).toBe(60);
    expect(secondiBlocco(cinque, dopo(59_001))).toBe(1);
    expect(secondiBlocco(cinque, dopo(60_000))).toBe(0);
    expect(tentativiRimasti(cinque)).toBe(5);
  });

  it('doubles the lock at every new lock, up to one hour', () => {
    expect([0, 1, 2, 3, 6, 10].map(durataBloccoMs)).toEqual([
      60_000,
      120_000,
      240_000,
      480_000,
      BLOCCO_MAX_MS,
      BLOCCO_MAX_MS,
    ]);

    const primo = falliscePerVolte(5);
    const secondo = falliscePerVolte(5, primo, dopo(61_000));
    expect(secondo.blocchi).toBe(2);
    expect(secondiBlocco(secondo, dopo(61_000))).toBe(120);
  });

  it('forgets a key idle for more than an hour', () => {
    const tre = falliscePerVolte(3);
    const dopoUnOra = registraFallimento(tre, dopo(61 * 60_000));
    expect(dopoUnOra.falliti).toBe(1);

    const bloccato = falliscePerVolte(5);
    const ancora = registraFallimento(bloccato, dopo(2 * 60 * 60_000));
    expect(ancora.blocchi).toBe(0);
  });

  it('keeps history while the key is recently active', () => {
    const bloccato = falliscePerVolte(5);
    const ripresa = registraFallimento(bloccato, dopo(5 * 60_000));
    expect(ripresa).toMatchObject({ falliti: 1, blocchi: 1 });
  });
});
