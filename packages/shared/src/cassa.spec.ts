import { describe, expect, it } from 'vitest';
import { type InputPreconto, MOTIVI_RIFIUTO, calcolaPreconto, traduciMotivo } from './cassa.js';
import { EstendiTempoSchema, RifiutaGiroSchema } from './cassa-schemi.js';

const formula = { nome: 'Cena', prezzoAdultoCent: 2990, prezzoBambinoCent: 1590 };
const nomi = new Map([
  ['acqua', 'Acqua naturale'],
  ['birra', 'Birra Asahi'],
]);
const voce = (piattoId: string, quantita: number, prezzoExtraCent: number | null = null) => ({
  piattoId,
  quantita,
  inFormula: prezzoExtraCent === null,
  prezzoExtraCent,
});

function preconto(extra: Partial<InputPreconto> = {}) {
  return calcolaPreconto({ formula, copertiAdulti: 3, copertiBambini: 1, giri: [], nomi, ...extra });
}

describe('calcolaPreconto', () => {
  it('bills the formula for adults and children', () => {
    const p = preconto();
    expect(p.righe).toEqual([
      expect.objectContaining({ tipo: 'ADULTI', quantita: 3, prezzoUnitarioCent: 2990, totaleCent: 8970 }),
      expect.objectContaining({ tipo: 'BAMBINI', quantita: 1, prezzoUnitarioCent: 1590, totaleCent: 1590 }),
    ]);
    expect(p.totaleCent).toBe(10_560);
  });

  it('leaves out the children line when there are none', () => {
    const p = preconto({ copertiBambini: 0 });
    expect(p.righe.map((r) => r.tipo)).toEqual(['ADULTI']);
    expect(p.totaleCent).toBe(8970);
  });

  it('adds the extras of approved rounds only, grouped by dish', () => {
    const p = preconto({
      copertiAdulti: 2,
      copertiBambini: 0,
      giri: [
        { stato: 'APPROVATO', voci: [voce('nigiri', 6), voce('acqua', 1, 250)] },
        { stato: 'APPROVATO', voci: [voce('acqua', 2, 250), voce('birra', 1, 500)] },
        { stato: 'RIFIUTATO', voci: [voce('birra', 5, 500)] },
        { stato: 'INVIATO', voci: [voce('birra', 1, 500)] },
      ],
    });
    expect(p.righe.filter((r) => r.tipo === 'EXTRA')).toEqual([
      {
        tipo: 'EXTRA',
        piattoId: 'acqua',
        descrizione: 'Acqua naturale',
        quantita: 3,
        prezzoUnitarioCent: 250,
        totaleCent: 750,
      },
      {
        tipo: 'EXTRA',
        piattoId: 'birra',
        descrizione: 'Birra Asahi',
        quantita: 1,
        prezzoUnitarioCent: 500,
        totaleCent: 500,
      },
    ]);
    expect(p.totaleCent).toBe(2 * 2990 + 750 + 500);
    expect(p.giriInAttesa).toBe(1);
  });

  it('uses the price copied on each round: a price change makes a separate line', () => {
    const p = preconto({
      copertiAdulti: 1,
      copertiBambini: 0,
      giri: [
        { stato: 'APPROVATO', voci: [voce('birra', 1, 500)] },
        { stato: 'APPROVATO', voci: [voce('birra', 2, 550)] },
      ],
    });
    const birre = p.righe.filter((r) => r.piattoId === 'birra');
    expect(birre.map((r) => [r.quantita, r.prezzoUnitarioCent, r.totaleCent])).toEqual([
      [1, 500, 500],
      [2, 550, 1100],
    ]);
  });

  it('never bills dishes included in the formula', () => {
    const p = preconto({ giri: [{ stato: 'APPROVATO', voci: [voce('nigiri', 40)] }] });
    expect(p.righe.some((r) => r.tipo === 'EXTRA')).toBe(false);
  });
});

describe('motivi di rifiuto', () => {
  it('translates a quick reason and keeps a free-text one as typed', () => {
    const primo = MOTIVI_RIFIUTO[0]!;
    expect(traduciMotivo(primo.it, 'en')).toBe(primo.en);
    expect(traduciMotivo(primo.it, 'it')).toBe(primo.it);
    expect(traduciMotivo('Cucina chiusa tra 5 minuti', 'en')).toBe('Cucina chiusa tra 5 minuti');
  });

  it('requires a non-empty reason', () => {
    expect(RifiutaGiroSchema.safeParse({ motivo: '   ' }).success).toBe(false);
    expect(RifiutaGiroSchema.parse({ motivo: '  Esaurito  ' })).toEqual({ motivo: 'Esaurito' });
  });

  it('accepts extra minutes between 1 and 240', () => {
    expect(EstendiTempoSchema.safeParse({ minuti: 0 }).success).toBe(false);
    expect(EstendiTempoSchema.safeParse({ minuti: 241 }).success).toBe(false);
    expect(EstendiTempoSchema.safeParse({ minuti: 15 }).success).toBe(true);
  });
});
