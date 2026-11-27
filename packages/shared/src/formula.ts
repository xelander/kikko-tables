import type { Formula } from './schemas/config.js';

/**
 * Copy of a formula stored on the session when a table is opened (CLAUDE.md §4).
 * Later changes by the administrator do not affect sessions already open.
 */
export interface FormulaSnapshot {
  versione: 1;
  id: string;
  codice: string;
  nome: { it: string; en: string };
  prezzoAdultoCent: number;
  prezzoBambinoCent: number;
  piattiPerPersonaPerGiro: number;
  minutiTraGiri: number;
  durataMaxMinuti: number;
  maxGiri: number | null;
}

export type FormulaConId = Formula & { id: string };

export function creaSnapshotFormula(formula: FormulaConId): FormulaSnapshot {
  return {
    versione: 1,
    id: formula.id,
    codice: formula.codice,
    nome: { it: formula.nome.it, en: formula.nome.en },
    prezzoAdultoCent: formula.prezzoAdultoCent,
    prezzoBambinoCent: formula.prezzoBambinoCent,
    piattiPerPersonaPerGiro: formula.piattiPerPersonaPerGiro,
    minutiTraGiri: formula.minutiTraGiri,
    durataMaxMinuti: formula.durataMaxMinuti,
    maxGiri: formula.maxGiri,
  };
}

const GIORNI: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Weekday (ISO, 1 = Monday) and `HH:mm` of an instant in the given IANA time zone. */
export function oraLocale(istante: Date, fusoOrario: string): { giorno: number; orario: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: fusoOrario,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(istante);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const giorno = GIORNI[get('weekday')];
  if (!giorno) throw new Error(`Cannot read weekday for ${istante.toISOString()} in ${fusoOrario}`);
  return { giorno, orario: `${get('hour')}:${get('minute')}` };
}

/**
 * Suggests the formula valid at `istante` in the restaurant's time zone: the first active one
 * (by `ordine`) with a time slot containing the local weekday and time (`da` inclusive, `a` exclusive).
 * Returns null when none matches; staff can always pick a formula by hand.
 */
export function proponiFormula<T extends Pick<Formula, 'fasce' | 'attiva' | 'ordine'>>(
  formule: readonly T[],
  istante: Date,
  fusoOrario: string,
): T | null {
  const { giorno, orario } = oraLocale(istante, fusoOrario);
  const candidate = formule
    .filter((f) => f.attiva)
    .filter((f) => f.fasce.some((fa) => fa.giorni.includes(giorno) && fa.da <= orario && orario < fa.a))
    .sort((a, b) => a.ordine - b.ordine);
  return candidate[0] ?? null;
}

/** Instant at which a session reaches its maximum duration, including minutes granted by staff. */
export function calcolaScadenza(apertaIl: Date, durataMaxMinuti: number, minutiExtra: number): Date {
  return new Date(apertaIl.getTime() + (durataMaxMinuti + minutiExtra) * 60_000);
}
