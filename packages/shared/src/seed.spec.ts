import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DefaultConfigSchema } from './schemas/config.js';
import { MenuSchema } from './schemas/menu.js';

function readSeed(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../seed/${name}`, import.meta.url), 'utf8'));
}

describe('versioned seed files', () => {
  it('default-config.json is valid and has the three default formulas', () => {
    const cfg = DefaultConfigSchema.parse(readSeed('default-config.json'));
    expect(cfg.formule.map((f) => f.codice)).toEqual(['pranzo-feriale', 'cena', 'weekend']);
    expect(cfg.impostazioni).toEqual({ nomeLocale: 'Kikko', fusoOrario: 'Europe/Rome', valuta: 'EUR' });
  });

  it('default formulas cover every day of the week at lunch and dinner', () => {
    const cfg = DefaultConfigSchema.parse(readSeed('default-config.json'));
    for (let giorno = 1; giorno <= 7; giorno++) {
      for (const orario of ['13:00', '20:00']) {
        const match = cfg.formule.filter((f) =>
          f.fasce.some((fa) => fa.giorni.includes(giorno) && fa.da <= orario && orario < fa.a),
        );
        expect(match, `giorno ${giorno} ore ${orario}`).toHaveLength(1);
      }
    }
  });

  it('menu-demo.json is valid and exercises extras and per-dish limits', () => {
    const menu = MenuSchema.parse(readSeed('menu-demo.json'));
    expect(menu.piatti.length).toBeGreaterThanOrEqual(30);
    expect(menu.piatti.some((p) => !p.inFormula)).toBe(true);
    expect(menu.piatti.some((p) => p.maxPerSeduta !== null)).toBe(true);
    expect(menu.piatti.some((p) => p.maxPerGiro !== null)).toBe(true);
    for (const p of menu.piatti) {
      expect(p.nome.it.length).toBeGreaterThan(0);
      expect(p.nome.en.length).toBeGreaterThan(0);
    }
  });
});
