import { provideHttpClient } from '@angular/common/http';
import { type HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CodaCassaDto, GiroCassaDto, SedutaRiepilogo, TavoloStato } from '@kikko/shared';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto, menuProva } from '../../testing/fakes';
import { CassaStore } from './cassa.store';
import { Suono } from './suono';

/** Test data for the till pages. */
export function giroProva(over: Partial<GiroCassaDto> = {}): GiroCassaDto {
  return {
    id: 'g1',
    sedutaId: 's4',
    numero: 1,
    stato: 'INVIATO',
    soloExtra: false,
    inviatoIl: new Date().toISOString(),
    gestitoIl: null,
    gestitoDa: null,
    motivoRifiuto: null,
    tavoli: [4],
    formula: 'Cena',
    coperti: 3,
    inviatoDa: { soprannome: 'Anna', emoji: '🐼' },
    voci: [
      { piattoId: 'p-salmone', quantita: 4, inFormula: true },
      { piattoId: 'p-acqua', quantita: 1, inFormula: false },
    ],
    ...over,
  };
}

export function codaProva(inAttesa: GiroCassaDto[] = [giroProva()], recenti: GiroCassaDto[] = []): CodaCassaDto {
  return { ora: new Date().toISOString(), inAttesa, recenti };
}

export function tavoloAperto(numero: number, over: Partial<SedutaRiepilogo> = {}): TavoloStato {
  const ora = Date.now();
  return {
    id: `t${numero}`,
    numero,
    slugQr: `tavolo-${numero}`,
    posti: 4,
    posX: 0,
    posY: 0,
    seduta: {
      id: `s${numero}`,
      apertaIl: new Date(ora - 60 * 60_000).toISOString(),
      scadeIl: new Date(ora + 90 * 60_000).toISOString(),
      scaduta: false,
      copertiAdulti: 2,
      copertiBambini: 1,
      formula: { id: 'f', codice: 'cena', nome: { it: 'Cena', en: 'Dinner' } },
      dispositiviCollegati: 1,
      pin: '1234',
      tavoli: [numero],
      giriInAttesa: 0,
      pezziNelCarrello: 0,
      ultimoGiroIl: null,
      ...over,
    },
  };
}

/** Providers for a till page: the real store, fake HTTP, fake realtime and silent sounds. */
export function providersCassa(realtime = new RealtimeFinto()): (Provider | EnvironmentProviders)[] {
  return [
    CassaStore,
    provideRouter([]),
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: RealtimeService, useValue: realtime },
    { provide: Suono, useValue: { pronto: false, sblocca: () => undefined, suona: () => undefined } },
  ];
}

/** Answers the three requests the store makes when created. */
export function rispondiStore(
  http: HttpTestingController,
  coda: CodaCassaDto = codaProva(),
  tavoli: TavoloStato[] = [tavoloAperto(4)],
): void {
  http.expectOne('/api/cassa/giri').flush(coda);
  http.expectOne('/api/tavoli').flush(tavoli);
  http.expectOne('/api/menu').flush(menuProva());
}

export async function attendi(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  TestBed.tick();
}
