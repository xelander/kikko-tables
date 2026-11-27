import { describe, expect, it } from 'vitest';
import {
  type ContestoGiro,
  type GiroPrecedente,
  type QuantitaPiatto,
  type RegolePiatto,
  disponibiliPerPiatto,
  giaOrdinati,
  limiteGiro,
  prossimoGiroIl,
  scadenzaSeduta,
  soloExtra,
  validaGiro,
} from './regole.js';

const APERTA = new Date('2026-11-27T19:00:00Z');
const min = (m: number) => new Date(APERTA.getTime() + m * 60_000);

function piatto(id: string, extra: Partial<RegolePiatto> = {}): RegolePiatto {
  return { id, inFormula: true, disponibile: true, maxPerPersona: null, maxPerGiro: null, gruppoId: null, ...extra };
}

const PIATTI = [
  piatto('nigiri'),
  piatto('uramaki'),
  piatto('bao', { maxPerPersona: 1 }),
  piatto('tataki', { maxPerPersona: 2 }),
  piatto('gamberoni', { maxPerGiro: 2 }),
  piatto('sashimi-salmone', { gruppoId: 'sashimi' }),
  piatto('sashimi-tonno', { gruppoId: 'sashimi' }),
  piatto('esaurito', { disponibile: false }),
  piatto('acqua', { inFormula: false }),
  piatto('birra', { inFormula: false }),
];

function ctx(over: Partial<ContestoGiro> = {}): ContestoGiro {
  return {
    formula: { piattiPerPersonaPerGiro: 5, minutiTraGiri: 10, durataMaxMinuti: 120, maxGiri: null },
    coperti: 2,
    apertaIl: APERTA,
    minutiExtra: 0,
    ora: min(5),
    giri: [],
    piatti: new Map(PIATTI.map((p) => [p.id, p])),
    gruppi: new Map([['sashimi', { id: 'sashimi', maxPerPersona: 4 }]]),
    ...over,
  };
}

const v = (piattoId: string, quantita: number): QuantitaPiatto => ({ piattoId, quantita });
const giro = (minuto: number, voci: QuantitaPiatto[], stato: GiroPrecedente['stato'] = 'INVIATO', solo = false) =>
  ({ stato, inviatoIl: min(minuto), soloExtra: solo, voci }) satisfies GiroPrecedente;
const codici = (c: ContestoGiro, voci: QuantitaPiatto[]) => validaGiro(c, voci).map((e) => e.codice);

describe('round limit (piattiPerPersonaPerGiro × covers)', () => {
  it('is per person × covers', () => {
    expect(limiteGiro(ctx())).toBe(10);
    expect(limiteGiro(ctx({ coperti: 4 }))).toBe(20);
  });

  it('accepts exactly the limit and refuses one more', () => {
    expect(validaGiro(ctx(), [v('nigiri', 6), v('uramaki', 4)])).toEqual([]);
    expect(validaGiro(ctx(), [v('nigiri', 6), v('uramaki', 5)])).toEqual([
      { codice: 'LIMITE_GIRO', richiesti: 11, limite: 10 },
    ]);
  });

  it('adds up lines of the same dish from different devices', () => {
    expect(codici(ctx(), [v('nigiri', 6), v('nigiri', 5)])).toEqual(['LIMITE_GIRO']);
  });

  it('does not count extras outside the formula', () => {
    expect(validaGiro(ctx(), [v('nigiri', 10), v('acqua', 3), v('birra', 2)])).toEqual([]);
  });
});

describe('per-dish limits', () => {
  it('maxPerGiro is for the whole table in one round', () => {
    expect(validaGiro(ctx(), [v('gamberoni', 2)])).toEqual([]);
    expect(validaGiro(ctx(), [v('gamberoni', 3)])).toEqual([
      { codice: 'MAX_PER_GIRO', piattoId: 'gamberoni', richiesti: 3, limite: 2 },
    ]);
  });

  it('maxPerPersona is "at most N times" per person for the whole session', () => {
    // 4 covers, bao max 1 per person → 4 bao for the table
    expect(validaGiro(ctx({ coperti: 4 }), [v('bao', 4)])).toEqual([]);
    expect(validaGiro(ctx({ coperti: 4 }), [v('bao', 5)])).toEqual([
      { codice: 'MAX_PER_PERSONA', piattoId: 'bao', richiesti: 5, giaOrdinati: 0, limite: 4 },
    ]);
  });

  it('maxPerPersona counts the previous sent and approved rounds', () => {
    const c = ctx({ ora: min(60), giri: [giro(0, [v('tataki', 1)]), giro(20, [v('tataki', 2)], 'APPROVATO')] });
    expect(validaGiro(c, [v('tataki', 1)])).toEqual([]);
    expect(validaGiro(c, [v('tataki', 2)])).toEqual([
      { codice: 'MAX_PER_PERSONA', piattoId: 'tataki', richiesti: 2, giaOrdinati: 3, limite: 4 },
    ]);
  });

  it('refuses unavailable and unknown dishes', () => {
    expect(validaGiro(ctx(), [v('esaurito', 1), v('fantasma', 1)])).toEqual([
      { codice: 'PIATTO_NON_DISPONIBILE', piattoId: 'esaurito' },
      { codice: 'PIATTO_INESISTENTE', piattoId: 'fantasma' },
    ]);
  });
});

describe('limit groups ("at most 4 in total")', () => {
  it('applies across the dishes of the group, per person', () => {
    // 2 covers × 4 = 8 sashimi in total
    expect(validaGiro(ctx(), [v('sashimi-salmone', 5), v('sashimi-tonno', 3)])).toEqual([]);
    expect(validaGiro(ctx(), [v('sashimi-salmone', 5), v('sashimi-tonno', 4)])).toEqual([
      { codice: 'LIMITE_GRUPPO', gruppoId: 'sashimi', richiesti: 9, giaOrdinati: 0, limite: 8 },
    ]);
  });

  it('counts what was already ordered in the group', () => {
    const c = ctx({ ora: min(30), giri: [giro(0, [v('sashimi-tonno', 6)])] });
    expect(codici(c, [v('sashimi-salmone', 2)])).toEqual([]);
    expect(codici(c, [v('sashimi-salmone', 3)])).toEqual(['LIMITE_GRUPPO']);
  });
});

describe('rejected rounds', () => {
  it('consume neither limits nor the timer', () => {
    const c = ctx({ ora: min(2), giri: [giro(1, [v('bao', 2), v('sashimi-salmone', 8)], 'RIFIUTATO')] });
    expect(validaGiro(c, [v('bao', 2), v('sashimi-salmone', 8)])).toEqual([]);
    expect(prossimoGiroIl(c)).toBeNull();
    expect(giaOrdinati(c).perPiatto.size).toBe(0);
  });
});

describe('time between rounds and number of rounds', () => {
  it('waits minutiTraGiri after the last valid round', () => {
    const giri = [giro(0, [v('nigiri', 2)]), giro(15, [v('nigiri', 2)], 'APPROVATO')];
    expect(prossimoGiroIl(ctx({ giri }))).toEqual(min(25));
    expect(validaGiro(ctx({ giri, ora: min(24) }), [v('nigiri', 1)])).toEqual([
      { codice: 'ATTESA_TRA_GIRI', prossimoGiroIl: min(25).toISOString() },
    ]);
    expect(validaGiro(ctx({ giri, ora: min(25) }), [v('nigiri', 1)])).toEqual([]);
  });

  it('lets a round of extras only through at any time, without starting the timer', () => {
    const giri = [giro(0, [v('nigiri', 2)])];
    const c = ctx({ giri, ora: min(1) });
    expect(soloExtra(c, [v('acqua', 2)])).toBe(true);
    expect(validaGiro(c, [v('acqua', 2)])).toEqual([]);
    expect(codici(c, [v('acqua', 2), v('nigiri', 1)])).toEqual(['ATTESA_TRA_GIRI']);
    const conExtra = ctx({ giri: [...giri, giro(12, [v('acqua', 1)], 'INVIATO', true)] });
    expect(prossimoGiroIl(conExtra)).toEqual(min(10));
  });

  it('applies maxGiri when the formula has one, ignoring rejected and extras-only rounds', () => {
    const formula = { piattiPerPersonaPerGiro: 5, minutiTraGiri: 0, durataMaxMinuti: 120, maxGiri: 2 };
    const giri = [
      giro(0, [v('nigiri', 1)]),
      giro(5, [v('nigiri', 1)], 'RIFIUTATO'),
      giro(6, [v('acqua', 1)], 'INVIATO', true),
    ];
    expect(validaGiro(ctx({ formula, giri, ora: min(10) }), [v('nigiri', 1)])).toEqual([]);
    const pieni = [...giri, giro(8, [v('nigiri', 1)], 'APPROVATO')];
    expect(validaGiro(ctx({ formula, giri: pieni, ora: min(10) }), [v('nigiri', 1)])).toEqual([
      { codice: 'MAX_GIRI', limite: 2 },
    ]);
  });
});

describe('maximum duration', () => {
  it('refuses every round after the deadline, extra minutes included', () => {
    expect(scadenzaSeduta(ctx())).toEqual(min(120));
    expect(codici(ctx({ ora: min(120) }), [v('nigiri', 1)])).toEqual(['TEMPO_SCADUTO']);
    expect(codici(ctx({ ora: min(120) }), [v('acqua', 1)])).toEqual(['TEMPO_SCADUTO']);
    expect(validaGiro(ctx({ ora: min(120), minutiExtra: 15 }), [v('nigiri', 1)])).toEqual([]);
  });
});

describe('formula snapshot', () => {
  it('only the rules passed in the context matter (the copy saved on the session)', () => {
    const snapshot = { piattiPerPersonaPerGiro: 3, minutiTraGiri: 0, durataMaxMinuti: 90, maxGiri: null };
    expect(codici(ctx({ formula: snapshot }), [v('nigiri', 7)])).toEqual(['LIMITE_GIRO']);
    expect(codici(ctx({ formula: snapshot }), [v('nigiri', 6)])).toEqual([]);
  });
});

describe('input validation', () => {
  it('refuses an empty cart and invalid quantities', () => {
    expect(codici(ctx(), [])).toEqual(['CARRELLO_VUOTO']);
    expect(codici(ctx(), [v('nigiri', 0)])).toEqual(['QUANTITA_NON_VALIDA']);
    expect(codici(ctx(), [v('nigiri', 1.5)])).toEqual(['QUANTITA_NON_VALIDA']);
    expect(codici(ctx(), [v('nigiri', 100)])).toEqual(['QUANTITA_NON_VALIDA']);
  });

  it('reports several violations at once', () => {
    expect(codici(ctx({ coperti: 1 }), [v('nigiri', 5), v('bao', 2), v('gamberoni', 3)])).toEqual([
      'LIMITE_GIRO',
      'MAX_PER_PERSONA',
      'MAX_PER_GIRO',
    ]);
  });
});

describe('disponibiliPerPiatto (what the + button allows)', () => {
  it('is the smallest margin among all the rules', () => {
    const c = ctx({ coperti: 2 });
    expect(disponibiliPerPiatto(c, [], 'nigiri')).toBe(10);
    expect(disponibiliPerPiatto(c, [v('uramaki', 8)], 'nigiri')).toBe(2);
    expect(disponibiliPerPiatto(c, [v('bao', 1)], 'bao')).toBe(1);
    expect(disponibiliPerPiatto(c, [v('gamberoni', 2)], 'gamberoni')).toBe(0);
    expect(disponibiliPerPiatto(c, [v('sashimi-tonno', 6)], 'sashimi-salmone')).toBe(2);
    expect(disponibiliPerPiatto(c, [v('nigiri', 10)], 'acqua')).toBe(99);
    expect(disponibiliPerPiatto(c, [], 'esaurito')).toBe(0);
  });

  it('never goes below zero', () => {
    expect(disponibiliPerPiatto(ctx(), [v('nigiri', 12)], 'uramaki')).toBe(0);
  });
});
