import { describe, expect, it } from 'vitest';
import { DefaultConfigSchema, FasciaOrariaSchema, FormulaSchema, ImpostazioniSchema } from './config.js';

const formulaBase = {
  codice: 'cena',
  nome: { it: 'Cena', en: 'Dinner' },
  prezzoAdultoCent: 2590,
  prezzoBambinoCent: 1490,
  fasce: [{ giorni: [1, 2, 3], da: '18:00', a: '24:00' }],
  piattiPerPersonaPerGiro: 6,
  minutiTraGiri: 10,
  durataMaxMinuti: 150,
};

describe('FormulaSchema', () => {
  it('accepts a valid formula and applies defaults', () => {
    const f = FormulaSchema.parse(formulaBase);
    expect(f.maxGiri).toBeNull();
    expect(f.attiva).toBe(true);
    expect(f.ordine).toBe(0);
  });

  it.each([
    ['negative price', { prezzoAdultoCent: -1 }],
    ['non-integer price', { prezzoAdultoCent: 25.9 }],
    ['zero dishes per person', { piattiPerPersonaPerGiro: 0 }],
    ['zero duration', { durataMaxMinuti: 0 }],
    ['no time slots', { fasce: [] }],
    ['invalid code', { codice: 'Cena Serale' }],
    ['empty English name', { nome: { it: 'Cena', en: ' ' } }],
  ])('rejects %s', (_label, patch) => {
    expect(FormulaSchema.safeParse({ ...formulaBase, ...patch }).success).toBe(false);
  });

  it('accepts zero minutes between rounds', () => {
    expect(FormulaSchema.safeParse({ ...formulaBase, minutiTraGiri: 0 }).success).toBe(true);
  });
});

describe('FasciaOrariaSchema', () => {
  it('accepts 24:00 as end of day', () => {
    expect(FasciaOrariaSchema.safeParse({ giorni: [6], da: '18:00', a: '24:00' }).success).toBe(true);
  });

  it.each([
    ['end before start', { giorni: [1], da: '15:00', a: '11:00' }],
    ['invalid weekday', { giorni: [0], da: '11:00', a: '15:00' }],
    ['duplicate weekday', { giorni: [1, 1], da: '11:00', a: '15:00' }],
    ['malformed time', { giorni: [1], da: '9:00', a: '15:00' }],
    ['25:00', { giorni: [1], da: '11:00', a: '25:00' }],
  ])('rejects %s', (_label, value) => {
    expect(FasciaOrariaSchema.safeParse(value).success).toBe(false);
  });
});

describe('ImpostazioniSchema', () => {
  it('rejects an unknown time zone', () => {
    const r = ImpostazioniSchema.safeParse({ nomeLocale: 'X', fusoOrario: 'Europe/Atlantide', valuta: 'EUR' });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed currency', () => {
    const r = ImpostazioniSchema.safeParse({ nomeLocale: 'X', fusoOrario: 'Europe/Rome', valuta: 'euro' });
    expect(r.success).toBe(false);
  });
});

describe('DefaultConfigSchema', () => {
  it('rejects duplicate formula codes', () => {
    const r = DefaultConfigSchema.safeParse({
      versione: 1,
      impostazioni: { nomeLocale: 'X', fusoOrario: 'Europe/Rome', valuta: 'EUR' },
      formule: [formulaBase, formulaBase],
    });
    expect(r.success).toBe(false);
  });
});
