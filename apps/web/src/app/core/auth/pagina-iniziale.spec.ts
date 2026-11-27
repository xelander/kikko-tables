import { paginaIniziale } from './staff.guard';

describe('paginaIniziale', () => {
  it('sends each role to its own area after login', () => {
    expect(paginaIniziale('CAMERIERE')).toBe('/staff/cameriere');
    expect(paginaIniziale('CAPO')).toBe('/staff/cassa');
    expect(paginaIniziale('MONITOR')).toBe('/monitor');
    expect(paginaIniziale('ADMIN')).toBe('/staff/cameriere');
  });
});
