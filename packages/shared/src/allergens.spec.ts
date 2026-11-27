import { describe, expect, it } from 'vitest';
import { ALLERGENI, ETICHETTE_ALLERGENI } from './allergens.js';

describe('ALLERGENI', () => {
  it('lists exactly the 14 allergens of EU Regulation 1169/2011', () => {
    expect(ALLERGENI).toHaveLength(14);
    expect(new Set(ALLERGENI).size).toBe(14);
  });

  it('has an Italian and English label for every allergen', () => {
    for (const code of ALLERGENI) {
      expect(ETICHETTE_ALLERGENI[code].it.length).toBeGreaterThan(0);
      expect(ETICHETTE_ALLERGENI[code].en.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ETICHETTE_ALLERGENI).sort()).toEqual([...ALLERGENI].sort());
  });
});
