import { conto, messaggioRegola, prezzo } from './testi-sala';

describe('customer texts', () => {
  const nome = () => 'Bao bun';
  const gruppo = () => 'Sashimi';

  it('formats countdowns and prices', () => {
    expect(conto(272_000)).toBe('04:32');
    expect(conto(3_910_000)).toBe('1:05:10');
    expect(conto(-5)).toBe('00:00');
    expect(prezzo(350, 'it').replace(/\s/g, ' ')).toBe('3,50 €');
    expect(prezzo(350, 'en')).toBe('€3.50');
  });

  it('explains every rule in both languages', () => {
    const ora = Date.parse('2026-11-27T20:00:00Z');
    expect(messaggioRegola({ codice: 'LIMITE_GIRO', richiesti: 14, limite: 12 }, 'it', nome, gruppo, ora)).toBe(
      'Troppi piatti in questo giro: 14 su un massimo di 12.',
    );
    expect(
      messaggioRegola(
        { codice: 'MAX_PER_PERSONA', piattoId: 'x', richiesti: 1, giaOrdinati: 4, limite: 4 },
        'en',
        nome,
        gruppo,
        ora,
      ),
    ).toBe('Bao bun: 4 already ordered, the table maximum is 4.');
    expect(
      messaggioRegola({ codice: 'ATTESA_TRA_GIRI', prossimoGiroIl: '2026-11-27T20:04:10Z' }, 'it', nome, gruppo, ora),
    ).toBe('Il prossimo giro si può inviare tra 5 min.');
    expect(
      messaggioRegola(
        { codice: 'LIMITE_GRUPPO', gruppoId: 'g', richiesti: 2, giaOrdinati: 8, limite: 8 },
        'it',
        nome,
        gruppo,
        ora,
      ),
    ).toContain('Sashimi');
  });
});
