/**
 * The 14 allergens that must be declared under EU Regulation 1169/2011 (Annex II).
 * Codes are stable identifiers stored in the database; labels are shown to customers.
 */
export const ALLERGENI = [
  'GLUTEN',
  'CRUSTACEANS',
  'EGGS',
  'FISH',
  'PEANUTS',
  'SOY',
  'MILK',
  'NUTS',
  'CELERY',
  'MUSTARD',
  'SESAME',
  'SULPHITES',
  'LUPIN',
  'MOLLUSCS',
] as const;

export type Allergene = (typeof ALLERGENI)[number];

export interface TestoLocalizzato {
  it: string;
  en: string;
}

export const ETICHETTE_ALLERGENI: Readonly<Record<Allergene, TestoLocalizzato>> = {
  GLUTEN: { it: 'Cereali contenenti glutine', en: 'Cereals containing gluten' },
  CRUSTACEANS: { it: 'Crostacei', en: 'Crustaceans' },
  EGGS: { it: 'Uova', en: 'Eggs' },
  FISH: { it: 'Pesce', en: 'Fish' },
  PEANUTS: { it: 'Arachidi', en: 'Peanuts' },
  SOY: { it: 'Soia', en: 'Soybeans' },
  MILK: { it: 'Latte', en: 'Milk' },
  NUTS: { it: 'Frutta a guscio', en: 'Tree nuts' },
  CELERY: { it: 'Sedano', en: 'Celery' },
  MUSTARD: { it: 'Senape', en: 'Mustard' },
  SESAME: { it: 'Semi di sesamo', en: 'Sesame seeds' },
  SULPHITES: { it: 'Anidride solforosa e solfiti', en: 'Sulphur dioxide and sulphites' },
  LUPIN: { it: 'Lupini', en: 'Lupin' },
  MOLLUSCS: { it: 'Molluschi', en: 'Molluscs' },
};
