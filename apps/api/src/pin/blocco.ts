/**
 * Anti brute force rules for PIN entry (CLAUDE.md §5). Pure functions: the clock is passed in.
 *
 * - After SOGLIA_TENTATIVI wrong attempts the key is locked.
 * - The lock lasts 60 s and doubles at every new lock (60 s, 120 s, 240 s…), up to one hour.
 * - A success resets the key. A key idle for an hour starts from scratch.
 */
export const SOGLIA_TENTATIVI = 5;
export const BLOCCO_BASE_MS = 60_000;
export const BLOCCO_MAX_MS = 60 * 60_000;
export const OBLIO_MS = 60 * 60_000;

export interface StatoBlocco {
  falliti: number;
  blocchi: number;
  bloccatoFino: Date | null;
  aggiornatoIl: Date | null;
}

export const STATO_INIZIALE: StatoBlocco = { falliti: 0, blocchi: 0, bloccatoFino: null, aggiornatoIl: null };

/** Forgets old history: a key untouched for OBLIO_MS (and not locked) starts again from zero. */
export function normalizza(stato: StatoBlocco, ora: Date): StatoBlocco {
  const bloccato = stato.bloccatoFino !== null && stato.bloccatoFino > ora;
  const vecchio = stato.aggiornatoIl !== null && ora.getTime() - stato.aggiornatoIl.getTime() > OBLIO_MS;
  return !bloccato && vecchio ? { ...STATO_INIZIALE } : stato;
}

/** Seconds left on the lock (rounded up), 0 if not locked. */
export function secondiBlocco(stato: StatoBlocco, ora: Date): number {
  if (!stato.bloccatoFino) return 0;
  const ms = stato.bloccatoFino.getTime() - ora.getTime();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

export function durataBloccoMs(blocchiPrecedenti: number): number {
  return Math.min(BLOCCO_BASE_MS * 2 ** blocchiPrecedenti, BLOCCO_MAX_MS);
}

/** New state after a wrong attempt. Starts a lock when the threshold is reached. */
export function registraFallimento(statoAttuale: StatoBlocco, ora: Date): StatoBlocco {
  const stato = normalizza(statoAttuale, ora);
  const falliti = stato.falliti + 1;
  if (falliti < SOGLIA_TENTATIVI) {
    return { ...stato, falliti, aggiornatoIl: ora };
  }
  return {
    falliti: 0,
    blocchi: stato.blocchi + 1,
    bloccatoFino: new Date(ora.getTime() + durataBloccoMs(stato.blocchi)),
    aggiornatoIl: ora,
  };
}

/** Attempts left before the next lock. */
export function tentativiRimasti(stato: StatoBlocco): number {
  return SOGLIA_TENTATIVI - stato.falliti;
}
