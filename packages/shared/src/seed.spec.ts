import { existsSync, readFileSync } from 'node:fs';
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

  describe('menu-kikko.json (real menu)', () => {
    const menu = MenuSchema.parse(readSeed('menu-kikko.json'));
    const menuPiatti = menu.piatti.filter((p) => p.inFormula);
    const bevande = menu.piatti.filter((p) => !p.inFormula);

    it('has the 155 dishes of the printed menu and the drinks as paid extras', () => {
      expect(menuPiatti).toHaveLength(155);
      expect(bevande.length).toBeGreaterThan(0);
      const sezioni = new Map(menu.categorie.map((c) => [c.codice, c.sezione]));
      for (const b of bevande) {
        expect(sezioni.get(b.categoria)).toBe('BEVANDE');
        expect(b.prezzoExtraCent).toBeGreaterThan(0);
      }
    });

    it('keeps the menu numbers, the à la carte prices and both languages', () => {
      for (const p of menuPiatti) {
        expect(p.numero).toMatch(/^\d{1,3}[a-z]?$/);
        expect(p.prezzoCartaCent).toBeGreaterThan(0);
        expect(p.nome.it.length).toBeGreaterThan(0);
        expect(p.nome.en.length).toBeGreaterThan(0);
        if (p.descrizione.it) expect(p.descrizione.en.length).toBeGreaterThan(0);
      }
    });

    it('has a photo for every dish of the menu', () => {
      for (const p of menuPiatti) {
        expect(p.immagine, p.codice).not.toBeNull();
        for (const w of [240, 480]) {
          expect(existsSync(new URL(`../seed/media/piatti/${p.immagine!.file}-${w}.webp`, import.meta.url))).toBe(true);
        }
      }
    });

    it('transcribes the limits of the printed menu', () => {
      const perNumero = new Map(menuPiatti.map((p) => [p.numero, p]));
      expect(perNumero.get('113')).toMatchObject({ maxPerPersona: 1 }); // Bao bun "massimo 1 volta"
      expect(perNumero.get('33')).toMatchObject({ maxPerPersona: 2 }); // Tataki "massimo 2 volte"
      expect(perNumero.get('149')).toMatchObject({ maxPerPersona: 3 });
      expect(menuPiatti.filter((p) => p.gruppo === 'sashimi').map((p) => p.numero)).toEqual(['66', '67', '68']);
      expect(menuPiatti.filter((p) => p.gruppo === 'carpacci-ponzu').map((p) => p.numero)).toEqual([
        '69',
        '70',
        '71',
        '72',
      ]);
      expect(menu.gruppi.every((g) => g.maxPerPersona === 4)).toBe(true);
    });
  });
});
