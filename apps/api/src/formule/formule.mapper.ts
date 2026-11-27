import { type FormulaConId, FasciaOrariaSchema } from '@kikko/shared';
import type { Formula } from '../generated/prisma/client.js';

/** Converts a database row to the shared Formula shape (validating the JSON time slots). */
export function formulaDaRiga(riga: Formula): FormulaConId {
  return {
    id: riga.id,
    codice: riga.codice,
    nome: { it: riga.nomeIt, en: riga.nomeEn },
    prezzoAdultoCent: riga.prezzoAdultoCent,
    prezzoBambinoCent: riga.prezzoBambinoCent,
    fasce: FasciaOrariaSchema.array().parse(riga.fasce),
    piattiPerPersonaPerGiro: riga.piattiPerPersonaPerGiro,
    minutiTraGiri: riga.minutiTraGiri,
    durataMaxMinuti: riga.durataMaxMinuti,
    maxGiri: riga.maxGiri,
    attiva: riga.attiva,
    ordine: riga.ordine,
  };
}
