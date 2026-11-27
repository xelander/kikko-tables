import { z } from 'zod';
import { CentesimiSchema, CodiceSchema, InteroPositivoSchema, OrarioSchema, TestoLocalizzatoSchema } from './common.js';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const GiornoSettimanaSchema = z.number().int().min(1).max(7);

export const FasciaOrariaSchema = z
  .object({
    giorni: z.array(GiornoSettimanaSchema).min(1),
    da: OrarioSchema,
    a: OrarioSchema,
  })
  .refine((f) => f.da < f.a, { message: "L'orario di fine deve seguire quello di inizio", path: ['a'] })
  .refine((f) => new Set(f.giorni).size === f.giorni.length, {
    message: 'Giorni duplicati',
    path: ['giorni'],
  });

export const FormulaSchema = z.object({
  codice: CodiceSchema,
  nome: TestoLocalizzatoSchema,
  prezzoAdultoCent: CentesimiSchema,
  prezzoBambinoCent: CentesimiSchema,
  fasce: z.array(FasciaOrariaSchema).min(1),
  piattiPerPersonaPerGiro: InteroPositivoSchema,
  minutiTraGiri: z.number().int().nonnegative(),
  durataMaxMinuti: InteroPositivoSchema,
  maxGiri: InteroPositivoSchema.nullable().default(null),
  attiva: z.boolean().default(true),
  ordine: z.number().int().default(0),
});

export const ImpostazioniSchema = z.object({
  nomeLocale: z.string().trim().min(1),
  fusoOrario: z.string().refine(isValidTimeZone, 'Fuso orario IANA non valido'),
  valuta: z.string().regex(/^[A-Z]{3}$/, 'Codice valuta ISO 4217'),
});

export const DefaultConfigSchema = z
  .object({
    versione: InteroPositivoSchema,
    impostazioni: ImpostazioniSchema,
    formule: z.array(FormulaSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    reportDuplicates(
      cfg.formule.map((f) => f.codice),
      ['formule'],
      ctx,
    );
  });

export type FasciaOraria = z.infer<typeof FasciaOrariaSchema>;
export type Formula = z.infer<typeof FormulaSchema>;
export type Impostazioni = z.infer<typeof ImpostazioniSchema>;
export type DefaultConfig = z.infer<typeof DefaultConfigSchema>;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function reportDuplicates(codes: readonly string[], path: (string | number)[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  codes.forEach((code, index) => {
    if (seen.has(code)) {
      ctx.addIssue({ code: 'custom', message: `Codice duplicato: ${code}`, path: [...path, index, 'codice'] });
    }
    seen.add(code);
  });
}
