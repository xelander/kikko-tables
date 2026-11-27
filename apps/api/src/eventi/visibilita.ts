import type { EventoDto, TipoEvento } from '@kikko/shared';

/**
 * What customers may see of each event of their own session, field by field (whitelist).
 * Types not listed here are never sent to customers. Staff ids and internal data never leave the server.
 */
const CAMPI_CLIENTE: Partial<Record<TipoEvento, readonly string[]>> = {
  DISPOSITIVO_UNITO: ['dispositivoId', 'soprannome', 'emoji'],
  CARRELLO_MODIFICATO: ['piattoId', 'quantita', 'dispositivoId'],
  GIRO_INVIATO: ['giroId', 'numero'],
  GIRO_APPROVATO: ['giroId', 'numero'],
  GIRO_RIFIUTATO: ['giroId', 'numero', 'motivo'],
  TEMPO_SCADUTO: [],
  TEMPO_ESTESO: ['minuti', 'scadeIl'],
  TAVOLI_UNITI: ['tavoli'],
  TAVOLO_SPOSTATO: ['tavoloNumero', 'tavoli'],
  COPERTI_MODIFICATI: ['copertiAdulti', 'copertiBambini'],
  TAVOLO_CHIUSO: [],
};

export const TIPI_VISIBILI_CLIENTE = Object.keys(CAMPI_CLIENTE) as TipoEvento[];

/** Events not tied to a session that every customer receives (the menu changed for everyone). */
const CAMPI_CLIENTE_GLOBALI: Partial<Record<TipoEvento, readonly string[]>> = {
  PIATTO_ESAURITO: ['piattoId'],
  PIATTO_RIPRISTINATO: ['piattoId'],
  // Only menu changes (see perCliente): open customer menus reload.
  CONFIG_MODIFICATA: ['ambito'],
};

export const TIPI_GLOBALI_CLIENTE = Object.keys(CAMPI_CLIENTE_GLOBALI) as TipoEvento[];

/**
 * Returns the version of an event that a customer of session `sedutaId` may receive, or null.
 * Customers only receive events of their own session, plus menu-wide ones (a dish sold out);
 * the actor is reduced to its role (plus the device id when the actor is another customer of the same table).
 */
export function perCliente(evento: EventoDto, sedutaId: string): EventoDto | null {
  const campi =
    evento.sedutaId === null
      ? CAMPI_CLIENTE_GLOBALI[evento.tipo]
      : evento.sedutaId === sedutaId
        ? CAMPI_CLIENTE[evento.tipo]
        : undefined;
  if (!campi) return null;
  if (evento.tipo === 'CONFIG_MODIFICATA' && evento.payload['ambito'] !== 'menu') return null;
  const payload = Object.fromEntries(campi.filter((c) => c in evento.payload).map((c) => [c, evento.payload[c]]));
  return {
    seq: evento.seq,
    ts: evento.ts,
    tipo: evento.tipo,
    attore:
      evento.attore.ruolo === 'CLIENTE' ? { ruolo: 'CLIENTE', id: evento.attore.id } : { ruolo: evento.attore.ruolo },
    sedutaId: evento.sedutaId,
    tavoloId: evento.tavoloId,
    payload,
  };
}
