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
      maxPerPersona: null,
      prezzoCartaCent: null,
      vegetariano: false,
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

  it('accepts the fields of the printed menu', () => {
    const p = PiattoSchema.parse({ ...piattoBase, numero: '8a', pezzi: 4, maxPerPersona: 2, prezzoCartaCent: 600 });
    expect(p).toMatchObject({ numero: '8a', pezzi: 4, maxPerPersona: 2, prezzoCartaCent: 600, gruppo: null });
    expect(PiattoSchema.safeParse({ ...piattoBase, numero: '8 a' }).success).toBe(false);
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

  it('rejects unknown groups, duplicate menu numbers and included dishes among drinks', () => {
    const bevande = { codice: 'bevande', nome: { it: 'Bevande', en: 'Drinks' }, sezione: 'BEVANDE' };
    const base = { versione: 1, categorie: [categoria, bevande] };
    expect(MenuSchema.safeParse({ ...base, piatti: [{ ...piattoBase, gruppo: 'sashimi' }] }).success).toBe(false);
    expect(
      MenuSchema.safeParse({
        ...base,
        gruppi: [{ codice: 'sashimi', nome: { it: 'Sashimi', en: 'Sashimi' }, maxPerPersona: 4 }],
        piatti: [{ ...piattoBase, gruppo: 'sashimi' }],
      }).success,
    ).toBe(true);
    expect(
      MenuSchema.safeParse({
        ...base,
        piatti: [
          { ...piattoBase, numero: '1' },
          { ...piattoBase, codice: 'altro', numero: '1' },
        ],
      }).success,
    ).toBe(false);
    expect(MenuSchema.safeParse({ ...base, piatti: [{ ...piattoBase, categoria: 'bevande' }] }).success).toBe(false);
  });

  it('rejects duplicate dish codes', () => {
    const r = MenuSchema.safeParse({ versione: 1, categorie: [categoria], piatti: [piattoBase, piattoBase] });
    expect(r.success).toBe(false);
  });
});
