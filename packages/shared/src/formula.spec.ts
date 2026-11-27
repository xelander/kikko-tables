import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calcolaScadenza, creaSnapshotFormula, oraLocale, proponiFormula } from './formula.js';
import { DefaultConfigSchema } from './schemas/config.js';

const config = DefaultConfigSchema.parse(
  JSON.parse(readFileSync(new URL('../seed/default-config.json', import.meta.url), 'utf8')),
);
const formule = config.formule;
const TZ = 'Europe/Rome';

/** Builds an instant from Italian local time (CET in winter = UTC+1, CEST in summer = UTC+2). */
function roma(iso: string, offset: '+01:00' | '+02:00'): Date {
  return new Date(`${iso}${offset}`);
}

describe('oraLocale', () => {
  it('reads weekday and time in the restaurant time zone, not UTC', () => {
    // Monday 23:30 UTC is already Tuesday 00:30 in Rome (winter time).
    expect(oraLocale(new Date('2026-11-30T23:30:00Z'), TZ)).toEqual({ giorno: 2, orario: '00:30' });
  });

  it('maps Sunday to 7', () => {
    expect(oraLocale(roma('2026-11-29T12:00:00', '+01:00'), TZ).giorno).toBe(7);
  });

  it('handles daylight saving time', () => {
    expect(oraLocale(new Date('2026-07-01T10:00:00Z'), TZ).orario).toBe('12:00');
    expect(oraLocale(new Date('2026-12-01T10:00:00Z'), TZ).orario).toBe('11:00');
  });
});

describe('proponiFormula', () => {
  it.each([
    ['Monday lunch', roma('2026-11-30T12:30:00', '+01:00'), 'pranzo-feriale'],
    ['Friday dinner', roma('2026-12-04T20:00:00', '+01:00'), 'cena'],
    ['Saturday lunch', roma('2026-12-05T13:00:00', '+01:00'), 'weekend'],
    ['Sunday dinner in summer', roma('2026-07-05T21:00:00', '+02:00'), 'weekend'],
    ['start of the slot is included', roma('2026-11-30T11:30:00', '+01:00'), 'pranzo-feriale'],
    ['just before midnight', roma('2026-11-30T23:59:00', '+01:00'), 'cena'],
  ])('%s → %s', (_label, istante, atteso) => {
    expect(proponiFormula(formule, istante, TZ)?.codice).toBe(atteso);
  });

  it('end of the slot is excluded', () => {
    expect(proponiFormula(formule, roma('2026-11-30T15:30:00', '+01:00'), TZ)).toBeNull();
  });

  it('returns null outside every slot', () => {
    expect(proponiFormula(formule, roma('2026-11-30T09:00:00', '+01:00'), TZ)).toBeNull();
  });

  it('ignores inactive formulas', () => {
    const disattivata = formule.map((f) => (f.codice === 'cena' ? { ...f, attiva: false } : f));
    expect(proponiFormula(disattivata, roma('2026-12-04T20:00:00', '+01:00'), TZ)).toBeNull();
  });

  it('prefers the lowest `ordine` when slots overlap', () => {
    const sovrapposte = [
      { ...formule[1]!, codice: 'b', ordine: 5 },
      { ...formule[1]!, codice: 'a', ordine: 1 },
    ];
    expect(proponiFormula(sovrapposte, roma('2026-12-04T20:00:00', '+01:00'), TZ)?.codice).toBe('a');
  });
});

describe('creaSnapshotFormula', () => {
  it('copies the rules and is detached from the source object', () => {
    const cena = { ...formule[1]!, id: '00000000-0000-4000-8000-000000000001' };
    const snapshot = creaSnapshotFormula(cena);
    expect(snapshot).toEqual({
      versione: 1,
      id: cena.id,
      codice: 'cena',
      nome: { it: 'Cena', en: 'Dinner' },
      prezzoAdultoCent: 2590,
      prezzoBambinoCent: 1490,
      piattiPerPersonaPerGiro: 6,
      minutiTraGiri: 10,
      durataMaxMinuti: 150,
      maxGiri: null,
    });
    cena.nome.it = 'Cambiata';
    cena.piattiPerPersonaPerGiro = 99;
    expect(snapshot.nome.it).toBe('Cena');
    expect(snapshot.piattiPerPersonaPerGiro).toBe(6);
  });

  it('survives a JSON round trip (how it is stored)', () => {
    const snapshot = creaSnapshotFormula({ ...formule[0]!, id: 'x' });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('calcolaScadenza', () => {
  it('adds the maximum duration and the extra minutes', () => {
    const aperta = new Date('2026-11-30T19:00:00Z');
    expect(calcolaScadenza(aperta, 150, 0).toISOString()).toBe('2026-11-30T21:30:00.000Z');
    expect(calcolaScadenza(aperta, 150, 20).toISOString()).toBe('2026-11-30T21:50:00.000Z');
  });
});
