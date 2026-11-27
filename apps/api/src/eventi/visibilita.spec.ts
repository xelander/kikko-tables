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

  it.each(['TAVOLO_APERTO', 'PIN_RIGENERATO', 'PIN_ERRATO', 'CLIENT_RICONNESSO', 'PRECONTO_GENERATO'] as const)(
    'never sends %s to customers',
    (tipo) => {
      expect(perCliente({ ...base, tipo }, 'seduta-1')).toBeNull();
      expect(TIPI_VISIBILI_CLIENTE).not.toContain(tipo);
    },
  );
});
