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

export const ApriTavoloSchema = z
  .object({
    formulaId: z.uuid(),
    copertiAdulti: z.number().int().min(0).max(50),
    copertiBambini: z.number().int().min(0).max(50),
  })
  .refine((r) => r.copertiAdulti + r.copertiBambini >= 1, {
    message: 'Serve almeno un coperto',
    path: ['copertiAdulti'],
  });
export type ApriTavoloRichiesta = z.infer<typeof ApriTavoloSchema>;

export interface SedutaRiepilogo {
  id: string;
  apertaIl: string;
  scadeIl: string;
  scaduta: boolean;
  copertiAdulti: number;
  copertiBambini: number;
  formula: { id: string; codice: string; nome: { it: string; en: string } };
  dispositiviCollegati: number;
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
