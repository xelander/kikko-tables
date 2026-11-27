import { describe, expect, it } from 'vitest';
import { MenuSchema, PiattoSchema } from './menu.js';

const piattoBase = {
  codice: 'nigiri-salmone',
  nome: { it: 'Nigiri salmone', en: 'Salmon nigiri' },
  categoria: 'nigiri',
  allergeni: ['FISH'],
};

describe('PiattoSchema', () => {
  it('applies defaults for an included dish', () => {
    const p = PiattoSchema.parse(piattoBase);
    expect(p).toMatchObject({
      inFormula: true,
      prezzoExtraCent: null,
      maxPerSeduta: null,
      maxPerGiro: null,
      disponibile: true,
      descrizione: { it: '', en: '' },
    });
  });

  it('requires a price for extras outside the formula', () => {
    expect(PiattoSchema.safeParse({ ...piattoBase, inFormula: false }).success).toBe(false);
    expect(PiattoSchema.safeParse({ ...piattoBase, inFormula: false, prezzoExtraCent: 300 }).success).toBe(true);
  });

  it('rejects a price on a dish included in the formula', () => {
    expect(PiattoSchema.safeParse({ ...piattoBase, prezzoExtraCent: 300 }).success).toBe(false);
  });

  it('rejects unknown or duplicate allergens', () => {
    expect(PiattoSchema.safeParse({ ...piattoBase, allergeni: ['PINEAPPLE'] }).success).toBe(false);
    expect(PiattoSchema.safeParse({ ...piattoBase, allergeni: ['FISH', 'FISH'] }).success).toBe(false);
  });

  it('rejects maxPerGiro greater than maxPerSeduta', () => {
    expect(PiattoSchema.safeParse({ ...piattoBase, maxPerSeduta: 1, maxPerGiro: 2 }).success).toBe(false);
    expect(PiattoSchema.safeParse({ ...piattoBase, maxPerSeduta: 3, maxPerGiro: 1 }).success).toBe(true);
  });

  it('rejects non-positive limits', () => {
    expect(PiattoSchema.safeParse({ ...piattoBase, maxPerGiro: 0 }).success).toBe(false);
  });
});

describe('MenuSchema', () => {
  const categoria = { codice: 'nigiri', nome: { it: 'Nigiri', en: 'Nigiri' } };

  it('rejects dishes pointing to an unknown category', () => {
    const r = MenuSchema.safeParse({
      versione: 1,
      categorie: [categoria],
      piatti: [{ ...piattoBase, categoria: 'dolci' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate dish codes', () => {
    const r = MenuSchema.safeParse({ versione: 1, categorie: [categoria], piatti: [piattoBase, piattoBase] });
    expect(r.success).toBe(false);
  });
});
