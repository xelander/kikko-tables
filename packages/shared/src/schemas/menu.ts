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

export const CategoriaSchema = z.object({
  codice: CodiceSchema,
  nome: TestoLocalizzatoSchema,
  ordine: z.number().int().default(0),
});

export const PiattoSchema = z
  .object({
    codice: CodiceSchema,
    nome: TestoLocalizzatoSchema,
    descrizione: TestoLocalizzatoOpzionaleSchema.default({ it: '', en: '' }),
    categoria: CodiceSchema,
    immagine: z.string().min(1).nullable().default(null),
    allergeni: z.array(AllergeneSchema).default([]),
    /** Included in the all-you-can-eat price. Extras are paid and do not count towards the round limit. */
    inFormula: z.boolean().default(true),
    prezzoExtraCent: CentesimiSchema.nullable().default(null),
    maxPerSeduta: InteroPositivoSchema.nullable().default(null),
    maxPerGiro: InteroPositivoSchema.nullable().default(null),
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
    if (p.maxPerGiro !== null && p.maxPerSeduta !== null && p.maxPerGiro > p.maxPerSeduta) {
      ctx.addIssue({
        code: 'custom',
        message: 'maxPerGiro non può superare maxPerSeduta',
        path: ['maxPerGiro'],
      });
    }
  });

export const MenuSchema = z
  .object({
    versione: InteroPositivoSchema,
    categorie: z.array(CategoriaSchema).min(1),
    piatti: z.array(PiattoSchema),
  })
  .superRefine((menu, ctx) => {
    reportDuplicates(
      menu.categorie.map((c) => c.codice),
      ['categorie'],
      ctx,
    );
    reportDuplicates(
      menu.piatti.map((p) => p.codice),
      ['piatti'],
      ctx,
    );
    const categorie = new Set(menu.categorie.map((c) => c.codice));
    menu.piatti.forEach((p, index) => {
      if (!categorie.has(p.categoria)) {
        ctx.addIssue({
          code: 'custom',
          message: `Categoria sconosciuta: ${p.categoria}`,
          path: ['piatti', index, 'categoria'],
        });
      }
    });
  });

export type Categoria = z.infer<typeof CategoriaSchema>;
export type Piatto = z.infer<typeof PiattoSchema>;
export type Menu = z.infer<typeof MenuSchema>;
