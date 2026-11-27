import type { EventoDto } from '@kikko/shared';
import { describe, expect, it } from 'vitest';
import { TIPI_VISIBILI_CLIENTE, perCliente } from './visibilita.js';

const base: EventoDto = {
  seq: 10,
  ts: '2026-11-27T20:00:00.000Z',
  tipo: 'DISPOSITIVO_UNITO',
  attore: { ruolo: 'CLIENTE', id: 'disp-1', dispositivoStaffId: null },
  sedutaId: 'seduta-1',
  tavoloId: 'tavolo-1',
  payload: { dispositivoId: 'disp-1', soprannome: 'Ospite 1', emoji: '🐼', ip: '1.2.3.4' },
};

describe('perCliente', () => {
  it('keeps only whitelisted payload fields', () => {
    expect(perCliente(base, 'seduta-1')).toEqual({
      ...base,
      attore: { ruolo: 'CLIENTE', id: 'disp-1' },
      payload: { dispositivoId: 'disp-1', soprannome: 'Ospite 1', emoji: '🐼' },
    });
  });

  it('never sends events of another session', () => {
    expect(perCliente(base, 'seduta-2')).toBeNull();
    expect(perCliente({ ...base, sedutaId: null }, 'seduta-1')).toBeNull();
  });

  it('hides staff identities', () => {
    const chiuso: EventoDto = {
      ...base,
      tipo: 'TAVOLO_CHIUSO',
      attore: { ruolo: 'CAPO', id: 'utente-7', dispositivoStaffId: 'tablet-cassa' },
      payload: { tavoli: [3], chiusaDa: 'utente-7' },
    };
    expect(perCliente(chiuso, 'seduta-1')).toMatchObject({ attore: { ruolo: 'CAPO' }, payload: {} });
    expect(perCliente(chiuso, 'seduta-1')?.attore).not.toHaveProperty('id');
  });

  it('sends menu-wide events (sold out / back) to every customer, with the dish id only', () => {
    const esaurito: EventoDto = {
      ...base,
      tipo: 'PIATTO_ESAURITO',
      attore: { ruolo: 'CAPO', id: 'utente-7', dispositivoStaffId: 'tablet-cassa' },
      sedutaId: null,
      tavoloId: null,
      payload: { piattoId: 'p-1', nome: 'Bao', numero: '12' },
    };
    expect(perCliente(esaurito, 'seduta-1')).toMatchObject({ attore: { ruolo: 'CAPO' }, payload: { piattoId: 'p-1' } });
    expect(perCliente(esaurito, 'seduta-1')?.payload).toEqual({ piattoId: 'p-1' });
    expect(perCliente({ ...esaurito, tipo: 'PIATTO_RIPRISTINATO' }, 'seduta-2')).not.toBeNull();
    // Only menu events: other events without a session stay staff-only.
    expect(perCliente({ ...esaurito, tipo: 'CONFIG_MODIFICATA' }, 'seduta-1')).toBeNull();
  });

  it('tells customers about menu changes made by the administrator, and about nothing else of the configuration', () => {
    const config: EventoDto = {
      ...base,
      tipo: 'CONFIG_MODIFICATA',
      attore: { ruolo: 'ADMIN', id: 'admin-1', dispositivoStaffId: null },
      sedutaId: null,
      tavoloId: null,
      payload: { ambito: 'menu', azione: 'MODIFICATO', piattoId: 'p-1', nome: 'Bao' },
    };
    expect(perCliente(config, 'seduta-1')?.payload).toEqual({ ambito: 'menu' });
    for (const ambito of ['formule', 'impostazioni', 'tavoli', 'utenti'])
      expect(perCliente({ ...config, payload: { ambito, azione: 'MODIFICATO' } }, 'seduta-1')).toBeNull();
  });

  it.each(['TAVOLO_APERTO', 'PIN_RIGENERATO', 'PIN_ERRATO', 'CLIENT_RICONNESSO', 'PRECONTO_GENERATO'] as const)(
    'never sends %s to customers',
    (tipo) => {
      expect(perCliente({ ...base, tipo }, 'seduta-1')).toBeNull();
      expect(TIPI_VISIBILI_CLIENTE).not.toContain(tipo);
    },
  );
});
