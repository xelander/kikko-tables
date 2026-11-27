import { describe, expect, it } from 'vitest';
import { TavoloSchema, generaTavoliDemo } from './tables.js';

describe('generaTavoliDemo', () => {
  it('creates 24 valid tables with unique numbers and slugs', () => {
    const tavoli = generaTavoliDemo();
    expect(tavoli).toHaveLength(24);
    expect(new Set(tavoli.map((t) => t.numero)).size).toBe(24);
    expect(new Set(tavoli.map((t) => t.slugQr)).size).toBe(24);
    for (const t of tavoli) expect(TavoloSchema.safeParse(t).success).toBe(true);
  });

  it('lays tables out on a grid', () => {
    const tavoli = generaTavoliDemo(8, 4);
    expect(tavoli[0]).toMatchObject({ numero: 1, slugQr: 'tavolo-01', posX: 0, posY: 0 });
    expect(tavoli[5]).toMatchObject({ numero: 6, posX: 1, posY: 1 });
  });
});
