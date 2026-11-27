import { z } from 'zod';
import type { Allergene, TestoLocalizzato } from './allergens.js';
import type { RuoloStaff } from './roles.js';
import { RUOLI_STAFF } from './roles.js';
import { CodiceSchema, InteroPositivoSchema, TestoLocalizzatoSchema } from './schemas/common.js';
import { FormulaSchema, ImpostazioniSchema } from './schemas/config.js';
import { CategoriaSchema, GruppoLimiteSchema, PiattoBaseSchema, type SezioneMenu, regolePiatto } from './schemas/menu.js';
import type { FasciaOraria } from './schemas/config.js';

// ---------- Administrator area (F5): requests ----------

export const ImpostazioniAdminSchema = ImpostazioniSchema.extend({
  /** A round waiting at least this many minutes is highlighted at the till. */
  sogliaGiroAttesaMin: z.number().int().min(1).max(60),
  /** Public address of the app printed in the QR codes (null: the address the admin is using). */
  urlBaseQr: z
    .url({ protocol: /^https?$/ })
    .transform((u) => u.replace(/\/+$/, ''))
    .nullable(),
});
export type ImpostazioniAdmin = z.infer<typeof ImpostazioniAdminSchema>;

export const FormulaAdminSchema = FormulaSchema;
export type FormulaAdminRichiesta = z.infer<typeof FormulaAdminSchema>;

export const CategoriaAdminSchema = CategoriaSchema;
export type CategoriaAdminRichiesta = z.infer<typeof CategoriaAdminSchema>;

export const GruppoAdminSchema = GruppoLimiteSchema;
export type GruppoAdminRichiesta = z.infer<typeof GruppoAdminSchema>;

/**
 * A dish as edited by the administrator. The photo is uploaded separately; the code is generated from the
 * Italian name when missing. Category and group are given by code, like in the seed files.
 */
export const PiattoAdminSchema = PiattoBaseSchema.omit({ immagine: true, codice: true })
  .extend({ codice: CodiceSchema.optional() })
  .superRefine(regolePiatto);
export type PiattoAdminRichiesta = z.infer<typeof PiattoAdminSchema>;

export const TavoloAdminSchema = z.object({
  numero: InteroPositivoSchema.max(999),
  posti: InteroPositivoSchema.max(50),
  attivo: z.boolean().default(true),
});
export type TavoloAdminRichiesta = z.infer<typeof TavoloAdminSchema>;

const PasswordSchema = z.string().min(6, 'Almeno 6 caratteri').max(200);
const PinStaffSchema = z.string().regex(/^\d{4,6}$/, 'Il PIN personale è di 4-6 cifre');

export const UtenteNuovoSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, 'Da 3 a 32 caratteri: lettere, cifre, punto, trattino'),
  nome: z.string().trim().min(1).max(60),
  ruolo: z.enum(RUOLI_STAFF),
  password: PasswordSchema,
  pin: PinStaffSchema.nullable().default(null),
});
export type UtenteNuovoRichiesta = z.infer<typeof UtenteNuovoSchema>;

export const UtenteModificaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  ruolo: z.enum(RUOLI_STAFF),
  attivo: z.boolean(),
  /** Omitted: unchanged. */
  password: PasswordSchema.optional(),
  /** Omitted: unchanged; null: removed. */
  pin: PinStaffSchema.nullable().optional(),
});
export type UtenteModificaRichiesta = z.infer<typeof UtenteModificaSchema>;

export const TestoAdminSchema = TestoLocalizzatoSchema;

// ---------- Administrator area: responses ----------

export interface ImpostazioniAdminDto {
  nomeLocale: string;
  fusoOrario: string;
  valuta: string;
  sogliaGiroAttesaMin: number;
  urlBaseQr: string | null;
}

export interface FormulaAdminDto {
  id: string;
  codice: string;
  nome: TestoLocalizzato;
  prezzoAdultoCent: number;
  prezzoBambinoCent: number;
  fasce: FasciaOraria[];
  piattiPerPersonaPerGiro: number;
  minutiTraGiri: number;
  durataMaxMinuti: number;
  maxGiri: number | null;
  attiva: boolean;
  ordine: number;
}

export interface CategoriaAdminDto {
  id: string;
  codice: string;
  nome: TestoLocalizzato;
  sezione: SezioneMenu;
  ordine: number;
  /** Dishes in the category (archived ones excluded). */
  piatti: number;
}

export interface GruppoAdminDto {
  id: string;
  codice: string;
  nome: TestoLocalizzato;
  maxPerPersona: number;
  piatti: number;
}

export interface PiattoAdminDto {
  id: string;
  codice: string;
  numero: string | null;
  nome: TestoLocalizzato;
  descrizione: TestoLocalizzato;
  categoria: string;
  pezzi: number | null;
  immagine: { src240: string; src480: string; larghezza: number; altezza: number; anteprima: string } | null;
  allergeni: Allergene[];
  vegetariano: boolean;
  piccante: boolean;
  senzaGlutine: boolean;
  inFormula: boolean;
  prezzoExtraCent: number | null;
  /** À la carte price: admin only. */
  prezzoCartaCent: number | null;
  maxPerPersona: number | null;
  maxPerGiro: number | null;
  gruppo: string | null;
  disponibile: boolean;
  ordine: number;
  archiviato: boolean;
  /** Already ordered at least once: it can be archived, not deleted. */
  ordinato: boolean;
}

export interface TavoloAdminDto {
  id: string;
  numero: number;
  slugQr: string;
  posti: number;
  attivo: boolean;
  /** A session is open on it now. */
  aperto: boolean;
}

export interface UtenteAdminDto {
  id: string;
  username: string;
  nome: string;
  ruolo: RuoloStaff;
  attivo: boolean;
  haPin: boolean;
}

/** Result of deleting a dish: removed, or archived because it was already ordered. */
export interface EsitoEliminazionePiatto {
  esito: 'ELIMINATO' | 'ARCHIVIATO';
}

export interface EsitoRipristinoFormule {
  formule: number;
}

export interface EsitoRipristinoMenu {
  categorie: number;
  piatti: number;
  /** Dishes not in the example menu but already ordered: archived, not deleted. */
  archiviati: number;
}
