import { z } from 'zod';
import { ALLERGENI } from '../allergens.js';

/** Stable identifier used in seeds and configuration (e.g. `cena`, `sushi-salmone`). */
export const CodiceSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa solo lettere minuscole, cifre e trattini');

export const TestoLocalizzatoSchema = z.object({
  it: z.string().trim().min(1),
  en: z.string().trim().min(1),
});

/** Optional localized text: both languages may be empty. */
export const TestoLocalizzatoOpzionaleSchema = z.object({
  it: z.string().trim().default(''),
  en: z.string().trim().default(''),
});

/** Amount in euro cents. */
export const CentesimiSchema = z.number().int().nonnegative();

export const InteroPositivoSchema = z.number().int().positive();

export const AllergeneSchema = z.enum(ALLERGENI);

/** Time of day in 24h format, `HH:mm`. `24:00` is accepted as end of day. */
export const OrarioSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Formato orario HH:mm');
