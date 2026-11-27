import { z } from 'zod';
import {
  AllergeneSchema,
  CentesimiSchema,
  CodiceSchema,
  InteroPositivoSchema,
  TestoLocalizzatoOpzionaleSchema,
  TestoLocalizzatoSchema,
} from './common.js';
import { reportDuplicates } from './config.js';

/** Where a category is shown to customers: the all-you-can-eat menu or the separate drinks page. */
export const SEZIONI_MENU = ['MENU', 'BEVANDE'] as const;
export type SezioneMenu = (typeof SEZIONI_MENU)[number];

export const CategoriaSchema = z.object({
  codice: CodiceSchema,
  nome: TestoLocalizzatoSchema,
  sezione: z.enum(SEZIONI_MENU).default('MENU'),
  ordine: z.number().int().default(0),
});

/**
 * A limit shared by several dishes, e.g. "sashimi: at most 4 in total".
 * Like the per-dish limit it is per person: the session limit is maxPerPersona × covers.
 */
export const GruppoLimiteSchema = z.object({
  codice: CodiceSchema,
  nome: TestoLocalizzatoSchema,
  maxPerPersona: InteroPositivoSchema,
});

export const ImmagineSchema = z.object({
  /** Base name of the files `{file}-480.webp` and `{file}-240.webp`. */
  file: z.string().regex(/^[a-z0-9-]+$/),
  larghezza: InteroPositivoSchema,
  altezza: InteroPositivoSchema,
  /** Tiny blurred preview (data URI) shown while the photo loads. */
  anteprima: z.string().startsWith('data:image/'),
});

export const PiattoSchema = z
  .object({
    codice: CodiceSchema,
    /** Number printed on the restaurant menu (e.g. "8a"), used by staff to talk about dishes. */
    numero: z
      .string()
      .regex(/^\d{1,3}[a-z]?$/)
      .nullable()
      .default(null),
    nome: TestoLocalizzatoSchema,
    descrizione: TestoLocalizzatoOpzionaleSchema.default({ it: '', en: '' }),
    categoria: CodiceSchema,
    pezzi: InteroPositivoSchema.nullable().default(null),
    immagine: ImmagineSchema.nullable().default(null),
    allergeni: z.array(AllergeneSchema).default([]),
    vegetariano: z.boolean().default(false),
    piccante: z.boolean().default(false),
    senzaGlutine: z.boolean().default(false),
    /** Included in the all-you-can-eat price. Extras are paid and do not count towards the round limit. */
    inFormula: z.boolean().default(true),
    /** Price of an extra, shown to customers. */
    prezzoExtraCent: CentesimiSchema.nullable().default(null),
    /** À la carte price from the printed menu: kept for the admin dashboard, never shown to customers. */
    prezzoCartaCent: CentesimiSchema.nullable().default(null),
    /** "At most N times": per person for the whole session (limit = N × covers). */
    maxPerPersona: InteroPositivoSchema.nullable().default(null),
    /** At most N pieces in a single round, for the whole table. */
    maxPerGiro: InteroPositivoSchema.nullable().default(null),
    /** Code of a shared limit group. */
    gruppo: CodiceSchema.nullable().default(null),
    disponibile: z.boolean().default(true),
    ordine: z.number().int().default(0),
  })
  .superRefine((p, ctx) => {
    if (!p.inFormula && p.prezzoExtraCent === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un piatto fuori formula deve avere un prezzo extra',
        path: ['prezzoExtraCent'],
      });
    }
    if (p.inFormula && p.prezzoExtraCent !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un piatto in formula non può avere un prezzo extra',
        path: ['prezzoExtraCent'],
      });
    }
    if (new Set(p.allergeni).size !== p.allergeni.length) {
      ctx.addIssue({ code: 'custom', message: 'Allergeni duplicati', path: ['allergeni'] });
    }
  });

export const MenuSchema = z
  .object({
    versione: InteroPositivoSchema,
    fonte: z.string().optional(),
    categorie: z.array(CategoriaSchema).min(1),
    gruppi: z.array(GruppoLimiteSchema).default([]),
    piatti: z.array(PiattoSchema),
  })
  .superRefine((menu, ctx) => {
    reportDuplicates(
      menu.categorie.map((c) => c.codice),
      ['categorie'],
      ctx,
    );
    reportDuplicates(
      menu.gruppi.map((g) => g.codice),
      ['gruppi'],
      ctx,
    );
    reportDuplicates(
      menu.piatti.map((p) => p.codice),
      ['piatti'],
      ctx,
    );
    const numeri = new Set<string>();
    const categorie = new Map(menu.categorie.map((c) => [c.codice, c]));
    const gruppi = new Set(menu.gruppi.map((g) => g.codice));
    menu.piatti.forEach((p, index) => {
      const categoria = categorie.get(p.categoria);
      if (!categoria) {
        ctx.addIssue({
          code: 'custom',
          message: `Categoria sconosciuta: ${p.categoria}`,
          path: ['piatti', index, 'categoria'],
        });
      } else if (categoria.sezione === 'BEVANDE' && p.inFormula) {
        ctx.addIssue({
          code: 'custom',
          message: 'Le voci della sezione bevande sono extra a pagamento',
          path: ['piatti', index, 'inFormula'],
        });
      }
      if (p.gruppo && !gruppi.has(p.gruppo)) {
        ctx.addIssue({ code: 'custom', message: `Gruppo sconosciuto: ${p.gruppo}`, path: ['piatti', index, 'gruppo'] });
      }
      if (p.numero) {
        if (numeri.has(p.numero)) {
          ctx.addIssue({ code: 'custom', message: `Numero duplicato: ${p.numero}`, path: ['piatti', index, 'numero'] });
        }
        numeri.add(p.numero);
      }
    });
  });

export type Categoria = z.infer<typeof CategoriaSchema>;
export type GruppoLimite = z.infer<typeof GruppoLimiteSchema>;
export type Immagine = z.infer<typeof ImmagineSchema>;
export type Piatto = z.infer<typeof PiattoSchema>;
export type Menu = z.infer<typeof MenuSchema>;
