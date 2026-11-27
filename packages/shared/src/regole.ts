/**
 * All-you-can-eat rules (CLAUDE.md §4). Pure functions shared by the server (which always decides)
 * and the client (which only uses them to guide the customer).
 *
 * - Round limit: piattiPerPersonaPerGiro × covers, counting only dishes included in the formula.
 * - Per dish: maxPerGiro (whole table, one round) and maxPerPersona (whole session, × covers).
 * - Limit groups: maxPerPersona × covers across all the dishes of the group.
 * - minutiTraGiri between two rounds, optional maxGiri, no rounds after the maximum duration.
 * - Rejected rounds count for nothing (neither limits nor timer).
 * - A round made only of extras (drinks) can be sent at any time and does not start the timer.
 */
import { calcolaScadenza } from './formula.js';

export const STATI_GIRO = ['INVIATO', 'APPROVATO', 'RIFIUTATO'] as const;
export type StatoGiro = (typeof STATI_GIRO)[number];

export const MAX_QUANTITA_VOCE = 99;

export interface RegolePiatto {
  id: string;
  inFormula: boolean;
  disponibile: boolean;
  maxPerPersona: number | null;
  maxPerGiro: number | null;
  gruppoId: string | null;
}

export interface RegoleGruppo {
  id: string;
  maxPerPersona: number;
}

export interface QuantitaPiatto {
  piattoId: string;
  quantita: number;
}

export interface GiroPrecedente {
  stato: StatoGiro;
  inviatoIl: Date | string;
  soloExtra: boolean;
  voci: readonly QuantitaPiatto[];
}

/** The rules of the formula as copied on the session when the table was opened. */
export interface RegoleFormula {
  piattiPerPersonaPerGiro: number;
  minutiTraGiri: number;
  durataMaxMinuti: number;
  maxGiri: number | null;
}

export interface ContestoGiro {
  formula: RegoleFormula;
  coperti: number;
  apertaIl: Date | string;
  minutiExtra: number;
  ora: Date;
  giri: readonly GiroPrecedente[];
  piatti: ReadonlyMap<string, RegolePiatto>;
  gruppi: ReadonlyMap<string, RegoleGruppo>;
}

export type ErroreRegola =
  | { codice: 'CARRELLO_VUOTO' }
  | { codice: 'QUANTITA_NON_VALIDA'; piattoId: string }
  | { codice: 'PIATTO_INESISTENTE'; piattoId: string }
  | { codice: 'PIATTO_NON_DISPONIBILE'; piattoId: string }
  | { codice: 'TEMPO_SCADUTO'; scadeIl: string }
  | { codice: 'ATTESA_TRA_GIRI'; prossimoGiroIl: string }
  | { codice: 'MAX_GIRI'; limite: number }
  | { codice: 'LIMITE_GIRO'; richiesti: number; limite: number }
  | { codice: 'MAX_PER_GIRO'; piattoId: string; richiesti: number; limite: number }
  | { codice: 'MAX_PER_PERSONA'; piattoId: string; richiesti: number; giaOrdinati: number; limite: number }
  | { codice: 'LIMITE_GRUPPO'; gruppoId: string; richiesti: number; giaOrdinati: number; limite: number };

const data = (d: Date | string) => (d instanceof Date ? d : new Date(d));

/** Rounds that count: sent or approved, not rejected. */
export function giriValidi(giri: readonly GiroPrecedente[]): GiroPrecedente[] {
  return giri.filter((g) => g.stato !== 'RIFIUTATO');
}

/** Rounds that count towards the timer and maxGiri (not rejected, not extras only). */
export function giriConteggiati(giri: readonly GiroPrecedente[]): GiroPrecedente[] {
  return giriValidi(giri).filter((g) => !g.soloExtra);
}

export function limiteGiro(ctx: Pick<ContestoGiro, 'formula' | 'coperti'>): number {
  return ctx.formula.piattiPerPersonaPerGiro * ctx.coperti;
}

export function scadenzaSeduta(ctx: Pick<ContestoGiro, 'formula' | 'apertaIl' | 'minutiExtra'>): Date {
  return calcolaScadenza(data(ctx.apertaIl), ctx.formula.durataMaxMinuti, ctx.minutiExtra);
}

/** When the next round may be sent (null: now, no previous round). */
export function prossimoGiroIl(ctx: Pick<ContestoGiro, 'formula' | 'giri'>): Date | null {
  const conteggiati = giriConteggiati(ctx.giri);
  if (conteggiati.length === 0) return null;
  const ultimo = Math.max(...conteggiati.map((g) => data(g.inviatoIl).getTime()));
  return new Date(ultimo + ctx.formula.minutiTraGiri * 60_000);
}

/** Pieces already ordered in the session (sent or approved rounds), per dish and per group. */
export function giaOrdinati(ctx: Pick<ContestoGiro, 'giri' | 'piatti'>): {
  perPiatto: Map<string, number>;
  perGruppo: Map<string, number>;
} {
  const perPiatto = new Map<string, number>();
  const perGruppo = new Map<string, number>();
  for (const giro of giriValidi(ctx.giri)) {
    for (const v of giro.voci) {
      perPiatto.set(v.piattoId, (perPiatto.get(v.piattoId) ?? 0) + v.quantita);
      const gruppo = ctx.piatti.get(v.piattoId)?.gruppoId;
      if (gruppo) perGruppo.set(gruppo, (perGruppo.get(gruppo) ?? 0) + v.quantita);
    }
  }
  return { perPiatto, perGruppo };
}

/** Sums duplicate lines (the cart has one line per dish per device). */
export function aggregaVoci(voci: readonly QuantitaPiatto[]): QuantitaPiatto[] {
  const somme = new Map<string, number>();
  for (const v of voci) somme.set(v.piattoId, (somme.get(v.piattoId) ?? 0) + v.quantita);
  return [...somme].map(([piattoId, quantita]) => ({ piattoId, quantita }));
}

/** Pieces of the round that count towards the round limit (dishes in the formula). */
export function piattiInFormula(ctx: Pick<ContestoGiro, 'piatti'>, voci: readonly QuantitaPiatto[]): number {
  return voci.reduce((tot, v) => tot + (ctx.piatti.get(v.piattoId)?.inFormula === false ? 0 : v.quantita), 0);
}

/** True when the round contains only paid extras (e.g. drinks). */
export function soloExtra(ctx: Pick<ContestoGiro, 'piatti'>, voci: readonly QuantitaPiatto[]): boolean {
  return voci.length > 0 && voci.every((v) => ctx.piatti.get(v.piattoId)?.inFormula === false);
}

/**
 * Checks a round against every rule. Returns all the violations (empty array: the round is valid).
 * The server runs this inside the transaction that saves the round.
 */
export function validaGiro(ctx: ContestoGiro, vociGrezze: readonly QuantitaPiatto[]): ErroreRegola[] {
  const errori: ErroreRegola[] = [];
  for (const v of vociGrezze) {
    if (!Number.isInteger(v.quantita) || v.quantita < 1 || v.quantita > MAX_QUANTITA_VOCE) {
      errori.push({ codice: 'QUANTITA_NON_VALIDA', piattoId: v.piattoId });
    }
  }
  if (errori.length > 0) return errori;
  const voci = aggregaVoci(vociGrezze);
  if (voci.length === 0) return [{ codice: 'CARRELLO_VUOTO' }];

  const scadeIl = scadenzaSeduta(ctx);
  if (ctx.ora >= scadeIl) return [{ codice: 'TEMPO_SCADUTO', scadeIl: scadeIl.toISOString() }];

  for (const v of voci) {
    const piatto = ctx.piatti.get(v.piattoId);
    if (!piatto) errori.push({ codice: 'PIATTO_INESISTENTE', piattoId: v.piattoId });
    else if (!piatto.disponibile) errori.push({ codice: 'PIATTO_NON_DISPONIBILE', piattoId: v.piattoId });
  }
  if (errori.length > 0) return errori;

  if (!soloExtra(ctx, voci)) {
    const prossimo = prossimoGiroIl(ctx);
    if (prossimo && ctx.ora < prossimo)
      errori.push({ codice: 'ATTESA_TRA_GIRI', prossimoGiroIl: prossimo.toISOString() });
    const maxGiri = ctx.formula.maxGiri;
    if (maxGiri !== null && giriConteggiati(ctx.giri).length >= maxGiri) {
      errori.push({ codice: 'MAX_GIRI', limite: maxGiri });
    }
    const richiesti = piattiInFormula(ctx, voci);
    const limite = limiteGiro(ctx);
    if (richiesti > limite) errori.push({ codice: 'LIMITE_GIRO', richiesti, limite });
  }

  const gia = giaOrdinati(ctx);
  const perGruppo = new Map<string, number>();
  for (const v of voci) {
    const piatto = ctx.piatti.get(v.piattoId)!;
    if (piatto.maxPerGiro !== null && v.quantita > piatto.maxPerGiro) {
      errori.push({ codice: 'MAX_PER_GIRO', piattoId: v.piattoId, richiesti: v.quantita, limite: piatto.maxPerGiro });
    }
    if (piatto.maxPerPersona !== null) {
      const limite = piatto.maxPerPersona * ctx.coperti;
      const giaOrdinati = gia.perPiatto.get(v.piattoId) ?? 0;
      if (giaOrdinati + v.quantita > limite) {
        errori.push({ codice: 'MAX_PER_PERSONA', piattoId: v.piattoId, richiesti: v.quantita, giaOrdinati, limite });
      }
    }
    if (piatto.gruppoId) perGruppo.set(piatto.gruppoId, (perGruppo.get(piatto.gruppoId) ?? 0) + v.quantita);
  }
  for (const [gruppoId, richiesti] of perGruppo) {
    const gruppo = ctx.gruppi.get(gruppoId);
    if (!gruppo) continue;
    const limite = gruppo.maxPerPersona * ctx.coperti;
    const giaOrdinati = gia.perGruppo.get(gruppoId) ?? 0;
    if (giaOrdinati + richiesti > limite) {
      errori.push({ codice: 'LIMITE_GRUPPO', gruppoId, richiesti, giaOrdinati, limite });
    }
  }
  return errori;
}

/** How many more pieces of a dish can be added to the current round, given the cart (null = no limit). */
export function disponibiliPerPiatto(
  ctx: ContestoGiro,
  carrello: readonly QuantitaPiatto[],
  piattoId: string,
): number | null {
  const piatto = ctx.piatti.get(piattoId);
  if (!piatto) return 0;
  if (!piatto.disponibile) return 0;
  const voci = aggregaVoci(carrello);
  const nelCarrello = voci.find((v) => v.piattoId === piattoId)?.quantita ?? 0;
  const gia = giaOrdinati(ctx);
  const margini: number[] = [];
  if (piatto.inFormula) margini.push(limiteGiro(ctx) - piattiInFormula(ctx, voci));
  if (piatto.maxPerGiro !== null) margini.push(piatto.maxPerGiro - nelCarrello);
  if (piatto.maxPerPersona !== null) {
    margini.push(piatto.maxPerPersona * ctx.coperti - (gia.perPiatto.get(piattoId) ?? 0) - nelCarrello);
  }
  const gruppo = piatto.gruppoId ? ctx.gruppi.get(piatto.gruppoId) : undefined;
  if (gruppo) {
    const nelGruppo = voci.reduce(
      (t, v) => t + (ctx.piatti.get(v.piattoId)?.gruppoId === gruppo.id ? v.quantita : 0),
      0,
    );
    margini.push(gruppo.maxPerPersona * ctx.coperti - (gia.perGruppo.get(gruppo.id) ?? 0) - nelGruppo);
  }
  margini.push(MAX_QUANTITA_VOCE - nelCarrello);
  return margini.length === 0 ? null : Math.max(0, Math.min(...margini));
}
