import { z } from 'zod';
import type { RuoloStaff } from './roles.js';

// ---------- Staff authentication ----------

export const LoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type LoginRichiesta = z.infer<typeof LoginSchema>;

export const LoginPinSchema = z.object({
  utenteId: z.uuid(),
  pin: z.string().regex(/^\d{4,6}$/),
});
export type LoginPinRichiesta = z.infer<typeof LoginPinSchema>;

export const RegistraDispositivoSchema = z.object({
  nome: z.string().trim().min(1).max(60),
});

export interface UtenteStaffDto {
  id: string;
  nome: string;
  username: string;
  ruolo: RuoloStaff;
}

export interface SessioneStaff {
  accessToken: string;
  /** Seconds until the access token expires. */
  scadeTra: number;
  utente: UtenteStaffDto;
  /** Shared device the user logged in from, if any. */
  dispositivo: { id: string; nome: string } | null;
}

/** What a shared device shows on its login screen. */
export interface DispositivoCondivisoInfo {
  registrato: boolean;
  nome: string | null;
  utenti: { id: string; nome: string; ruolo: RuoloStaff }[];
}

// ---------- Tables and sessions (staff) ----------

const coperti = {
  copertiAdulti: z.number().int().min(0).max(50),
  copertiBambini: z.number().int().min(0).max(50),
};
const almenoUnCoperto = (r: { copertiAdulti: number; copertiBambini: number }) =>
  r.copertiAdulti + r.copertiBambini >= 1;

export const ApriTavoloSchema = z
  .object({ formulaId: z.uuid(), ...coperti })
  .refine(almenoUnCoperto, { message: 'Serve almeno un coperto', path: ['copertiAdulti'] });
export type ApriTavoloRichiesta = z.infer<typeof ApriTavoloSchema>;

export const CopertiSchema = z
  .object(coperti)
  .refine(almenoUnCoperto, { message: 'Serve almeno un coperto', path: ['copertiAdulti'] });
export type CopertiRichiesta = z.infer<typeof CopertiSchema>;

/** Move the session from one of its tables to a free table. */
export const SpostaTavoloSchema = z.object({ daTavoloId: z.uuid(), aTavoloId: z.uuid() });
export type SpostaTavoloRichiesta = z.infer<typeof SpostaTavoloSchema>;

/** Join a free table to an open session. */
export const AggiungiTavoloSchema = z.object({ tavoloId: z.uuid() });
export type AggiungiTavoloRichiesta = z.infer<typeof AggiungiTavoloSchema>;

/** Merge another open session (same formula) into this one. */
export const UnisciSeduteSchema = z.object({ sedutaId: z.uuid() });
export type UnisciSeduteRichiesta = z.infer<typeof UnisciSeduteSchema>;

export interface SedutaRiepilogo {
  id: string;
  apertaIl: string;
  scadeIl: string;
  scaduta: boolean;
  copertiAdulti: number;
  copertiBambini: number;
  formula: { id: string; codice: string; nome: { it: string; en: string } };
  /** Customer phones joined (the staff ordering device is not counted). */
  dispositiviCollegati: number;
  /** The table PIN, always visible to staff (null for sessions opened before it was stored). Never sent to customers. */
  pin: string | null;
  /** Numbers of every table of the session (more than one when tables are joined). */
  tavoli: number[];
  /** Rounds sent and waiting for approval. */
  giriInAttesa: number;
  /** Pieces currently in the shared cart. */
  pezziNelCarrello: number;
  ultimoGiroIl: string | null;
}

export interface TavoloStato {
  id: string;
  numero: number;
  slugQr: string;
  posti: number;
  posX: number;
  posY: number;
  seduta: SedutaRiepilogo | null;
}

export interface SedutaConPin {
  seduta: SedutaRiepilogo;
  tavoloId: string;
  /** The 4-digit PIN in clear text: returned only when it is generated, never stored. */
  pin: string;
}

export interface FormulaDto {
  id: string;
  codice: string;
  nome: { it: string; en: string };
  prezzoAdultoCent: number;
  prezzoBambinoCent: number;
}

export interface FormuleDisponibili {
  formule: FormulaDto[];
  /** Formula suggested for the current time in the restaurant's time zone. */
  propostaId: string | null;
}

// ---------- Customer access ----------

export const JoinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'Il PIN è di 4 cifre'),
  soprannome: z.string().trim().max(20).optional(),
});
export type JoinRichiesta = z.infer<typeof JoinSchema>;

export interface DispositivoClienteDto {
  id: string;
  soprannome: string;
  emoji: string;
}

export type StatoTavoloCliente =
  | { stato: 'NON_ATTIVO'; tavolo: { numero: number } }
  | { stato: 'PIN_RICHIESTO'; tavolo: { numero: number }; bloccatoPerSecondi: number }
  | {
      stato: 'CONNESSO';
      tavolo: { numero: number };
      sedutaId: string;
      dispositivo: DispositivoClienteDto;
      scadeIl: string;
      formula: { nome: { it: string; en: string } };
    };

/** Error body of `POST /api/t/:slug/join`. */
export type ErroreJoin =
  | { codice: 'PIN_ERRATO'; tentativiRimasti: number }
  | { codice: 'BLOCCATO'; riprovaTraSecondi: number }
  | { codice: 'NON_ATTIVO' };
