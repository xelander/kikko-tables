import type { TestoLocalizzato } from './allergens.js';
import type { StatoGiro } from './regole.js';

// ---------- Cashier / manager area (CLAUDE.md §3 step 5–6, F4) ----------
// Browser-safe: no Zod here (request schemas live in cassa-schemi.ts).

/** A round waiting longer than this is highlighted in the cashier queue. */
export const SOGLIA_GIRO_IN_ATTESA_MIN = 5;

/** Extra minutes offered as quick buttons to the manager. */
export const MINUTI_EXTRA_RAPIDI = [10, 15, 30] as const;
export const MAX_MINUTI_EXTRA = 240;

/**
 * Quick rejection reasons. The Italian text is what is stored; customers reading in English
 * see the matching translation (a free-text reason is shown as typed).
 */
export const MOTIVI_RIFIUTO: readonly TestoLocalizzato[] = [
  {
    it: 'Uno o più piatti sono esauriti: rifate il giro senza.',
    en: 'One or more dishes are sold out: please send the round again without them.',
  },
  { it: 'Ci sono ancora piatti da finire al tavolo.', en: 'There are still dishes to finish at your table.' },
  { it: 'Giro doppio: lo abbiamo già ricevuto.', en: 'Duplicate round: we have already received it.' },
  { it: 'Chiedete al cameriere, passa subito da voi.', en: 'Please ask the waiter, who will come to your table.' },
];

export function traduciMotivo(motivo: string, lingua: 'it' | 'en'): string {
  const noto = MOTIVI_RIFIUTO.find((m) => m.it === motivo);
  return noto ? noto[lingua] : motivo;
}

/** A round as the cashier sees it. */
export interface GiroCassaDto {
  id: string;
  sedutaId: string;
  numero: number;
  stato: StatoGiro;
  soloExtra: boolean;
  inviatoIl: string;
  gestitoIl: string | null;
  gestitoDa: string | null;
  motivoRifiuto: string | null;
  tavoli: number[];
  formula: string;
  coperti: number;
  /** Who pressed "send": a customer phone or the waiter's ordering device. */
  inviatoDa: { soprannome: string; emoji: string } | null;
  voci: { piattoId: string; quantita: number; inFormula: boolean }[];
}

export interface CodaCassaDto {
  /** Server clock, to compute waiting times. */
  ora: string;
  /** Rounds to approve, oldest first. */
  inAttesa: GiroCassaDto[];
  /** Last rounds handled (most recent first), for reference. */
  recenti: GiroCassaDto[];
}

/** A dish as listed in the "sold out" screen. */
export interface PiattoCassaDto {
  id: string;
  numero: string | null;
  nome: string;
  categoria: string;
  inFormula: boolean;
  disponibile: boolean;
}

/** Time of a session after extra minutes were granted. */
export interface TempoSedutaDto {
  sedutaId: string;
  minutiExtra: number;
  scadeIl: string;
}

export interface EstensioneTuttiDto {
  /** Open sessions that received the extra minutes. */
  sedute: number;
}

// ---------- Pre-bill ("documento non fiscale", CLAUDE.md §9) ----------

export interface RigaPreconto {
  tipo: 'ADULTI' | 'BAMBINI' | 'EXTRA';
  piattoId: string | null;
  descrizione: string;
  quantita: number;
  prezzoUnitarioCent: number;
  totaleCent: number;
}

export interface PrecontoDto {
  sedutaId: string;
  nomeLocale: string;
  valuta: string;
  tavoli: number[];
  formula: string;
  apertaIl: string;
  generatoIl: string;
  copertiAdulti: number;
  copertiBambini: number;
  righe: RigaPreconto[];
  totaleCent: number;
  /** Rounds still waiting for approval: their extras are not in the total yet. */
  giriInAttesa: number;
}

export interface VocePreconto {
  piattoId: string;
  quantita: number;
  /** Copied when the round was sent. */
  inFormula: boolean;
  prezzoExtraCent: number | null;
}

export interface InputPreconto {
  formula: { nome: string; prezzoAdultoCent: number; prezzoBambinoCent: number };
  copertiAdulti: number;
  copertiBambini: number;
  giri: readonly { stato: StatoGiro; voci: readonly VocePreconto[] }[];
  /** Dish names for the extras lines. */
  nomi: ReadonlyMap<string, string>;
}

/**
 * Pre-bill: formula × covers (adults and children) plus the extras of approved rounds,
 * at the price copied when each round was sent. Rounds waiting or rejected are not billed.
 * Informational only: the fiscal receipt is issued by the cash register.
 */
export function calcolaPreconto(input: InputPreconto): {
  righe: RigaPreconto[];
  totaleCent: number;
  giriInAttesa: number;
} {
  const righe: RigaPreconto[] = [];
  const coperto = (tipo: 'ADULTI' | 'BAMBINI', quantita: number, prezzo: number, descrizione: string) => {
    if (quantita > 0)
      righe.push({
        tipo,
        piattoId: null,
        descrizione,
        quantita,
        prezzoUnitarioCent: prezzo,
        totaleCent: quantita * prezzo,
      });
  };
  coperto('ADULTI', input.copertiAdulti, input.formula.prezzoAdultoCent, `${input.formula.nome} – adulti`);
  coperto('BAMBINI', input.copertiBambini, input.formula.prezzoBambinoCent, `${input.formula.nome} – bambini`);

  // Extras grouped by dish and price (the price may differ between rounds if it changed in between).
  const extra = new Map<string, RigaPreconto>();
  for (const giro of input.giri) {
    if (giro.stato !== 'APPROVATO') continue;
    for (const v of giro.voci) {
      if (v.inFormula || v.quantita <= 0) continue;
      const prezzo = v.prezzoExtraCent ?? 0;
      const chiave = `${v.piattoId}:${prezzo}`;
      const riga = extra.get(chiave) ?? {
        tipo: 'EXTRA' as const,
        piattoId: v.piattoId,
        descrizione: input.nomi.get(v.piattoId) ?? 'Extra',
        quantita: 0,
        prezzoUnitarioCent: prezzo,
        totaleCent: 0,
      };
      riga.quantita += v.quantita;
      riga.totaleCent = riga.quantita * prezzo;
      extra.set(chiave, riga);
    }
  }
  righe.push(...extra.values());
  return {
    righe,
    totaleCent: righe.reduce((t, r) => t + r.totaleCent, 0),
    giriInAttesa: input.giri.filter((g) => g.stato === 'INVIATO').length,
  };
}
