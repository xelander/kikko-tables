import type { EventoDto } from '@kikko/shared';
import { SincronizzatoreEventi } from './sincronizzatore';

const ev = (seq: number): EventoDto => ({
  seq,
  ts: new Date(0).toISOString(),
  tipo: 'TAVOLO_APERTO',
  attore: { ruolo: 'CAMERIERE' },
  sedutaId: null,
  tavoloId: null,
  payload: {},
});

describe('SincronizzatoreEventi', () => {
  function crea(ultimo: number | null) {
    const applicati: number[] = [];
    const s = new SincronizzatoreEventi(ultimo, (e) => applicati.push(e.seq));
    return { s, applicati };
  }

  it('applies live events once, in order of arrival', () => {
    const { s, applicati } = crea(10);
    [11, 12, 12, 9].forEach((n) => s.ricevi(ev(n)));
    expect(applicati).toEqual([11, 12]);
    expect(s.ultimoSeq).toBe(12);
  });

  it('applies recovered events before live events that arrived during the sync', () => {
    const { s, applicati } = crea(10);
    s.inizioSync();
    s.ricevi(ev(15)); // live, newer than the backlog
    s.ricevi(ev(13)); // live, also part of the backlog
    const snapshot = s.fineSync({ esito: 'eventi', eventi: [ev(11), ev(13), ev(14)], ultimoSeq: 14 });
    expect(snapshot).toBe(false);
    expect(applicati).toEqual([11, 13, 14, 15]);
    expect(s.ultimoSeq).toBe(15);
  });

  it('moves the cursor to the head even when no event was meant for this client', () => {
    const { s, applicati } = crea(null);
    s.inizioSync();
    s.fineSync({ esito: 'eventi', eventi: [], ultimoSeq: 500 });
    expect(s.ultimoSeq).toBe(500);
    s.ricevi(ev(499));
    s.ricevi(ev(501));
    expect(applicati).toEqual([501]);
  });

  it('reports when a full snapshot is needed', () => {
    const { s } = crea(1);
    s.inizioSync();
    expect(s.fineSync({ esito: 'snapshot_required', ultimoSeq: 2000 })).toBe(true);
    expect(s.ultimoSeq).toBe(2000);
  });

  it('flushes queued events if the sync is cancelled', () => {
    const { s, applicati } = crea(1);
    s.inizioSync();
    s.ricevi(ev(3));
    s.ricevi(ev(2));
    s.annullaSync();
    expect(applicati).toEqual([2, 3]);
  });
});
