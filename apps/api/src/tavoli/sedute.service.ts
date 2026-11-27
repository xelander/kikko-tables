import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ApriTavoloRichiesta,
  type FormulaSnapshot,
  type SedutaConPin,
  type SedutaRiepilogo,
  type TavoloStato,
  calcolaScadenza,
  creaSnapshotFormula,
} from '@kikko/shared';
import { randomUUID } from 'node:crypto';
import type { Attore } from '../common/attore.js';
import { generaPin, hmacPin } from '../common/crypto.js';
import type { Env } from '../config/env.js';
import { EventiService, type Tx } from '../eventi/eventi.service.js';
import { formulaDaRiga } from '../formule/formule.mapper.js';
import type { Prisma } from '../generated/prisma/client.js';
import { BlocchiService, chiaveTavolo } from '../pin/blocchi.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const includeSeduta = {
  dispositivi: { where: { revocatoIl: null }, select: { id: true } },
} satisfies Prisma.SedutaInclude;

type SedutaConDispositivi = Prisma.SedutaGetPayload<{ include: typeof includeSeduta }>;

export function riepilogoSeduta(s: SedutaConDispositivi, ora = new Date()): SedutaRiepilogo {
  const formula = s.formulaSnapshot as unknown as FormulaSnapshot;
  const scadeIl = calcolaScadenza(s.apertaIl, formula.durataMaxMinuti, s.minutiExtra);
  return {
    id: s.id,
    apertaIl: s.apertaIl.toISOString(),
    scadeIl: scadeIl.toISOString(),
    scaduta: scadeIl <= ora,
    copertiAdulti: s.copertiAdulti,
    copertiBambini: s.copertiBambini,
    formula: { id: formula.id, codice: formula.codice, nome: formula.nome },
    dispositiviCollegati: s.dispositivi.length,
  };
}

/** Tables and sessions (CLAUDE.md §3). Every change is recorded in the event log in the same transaction. */
@Injectable()
export class SeduteService {
  private readonly segretoPin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventi: EventiService,
    private readonly blocchi: BlocchiService,
    config: ConfigService<Env, true>,
  ) {
    this.segretoPin = config.get('PIN_HMAC_SECRET', { infer: true });
  }

  async elencoTavoli(): Promise<TavoloStato[]> {
    const tavoli = await this.prisma.tavolo.findMany({
      where: { attivo: true },
      orderBy: { numero: 'asc' },
      include: { sedutaCorrente: { include: includeSeduta } },
    });
    const ora = new Date();
    return tavoli.map((t) => ({
      id: t.id,
      numero: t.numero,
      slugQr: t.slugQr,
      posti: t.posti,
      posX: t.posX,
      posY: t.posY,
      seduta: t.sedutaCorrente ? riepilogoSeduta(t.sedutaCorrente, ora) : null,
    }));
  }

  /** Opens a table: creates the session with a snapshot of the formula and a new PIN. */
  async apri(tavoloId: string, richiesta: ApriTavoloRichiesta, attore: Attore): Promise<SedutaConPin> {
    const sedutaId = randomUUID();
    const pin = generaPin();
    const seduta = await this.eventi.transazione(async (tx, registro) => {
      const tavolo = await tx.tavolo.findUnique({ where: { id: tavoloId } });
      if (!tavolo || !tavolo.attivo) throw new NotFoundException({ codice: 'TAVOLO_INESISTENTE' });
      const riga = await tx.formula.findUnique({ where: { id: richiesta.formulaId } });
      if (!riga || !riga.attiva) throw new BadRequestException({ codice: 'FORMULA_NON_VALIDA' });
      const snapshot = creaSnapshotFormula(formulaDaRiga(riga));

      const creata = await tx.seduta.create({
        data: {
          id: sedutaId,
          formulaId: riga.id,
          formulaSnapshot: snapshot as unknown as Prisma.InputJsonObject,
          copertiAdulti: richiesta.copertiAdulti,
          copertiBambini: richiesta.copertiBambini,
          pinHash: hmacPin(this.segretoPin, sedutaId, pin),
          apertaDaId: attore.id!,
          tavoli: { create: { tavoloId } },
        },
        include: includeSeduta,
      });
      // Conditional update: two waiters opening the same table at once cannot both succeed.
      const occupato = await tx.tavolo.updateMany({
        where: { id: tavoloId, sedutaCorrenteId: null },
        data: { sedutaCorrenteId: sedutaId },
      });
      if (occupato.count === 0) throw new ConflictException({ codice: 'TAVOLO_GIA_APERTO' });
      await this.blocchi.azzera(tx, [chiaveTavolo(tavoloId)]);
      await registro.registra({
        tipo: 'TAVOLO_APERTO',
        attore,
        sedutaId,
        tavoloId,
        payload: {
          tavoloNumero: tavolo.numero,
          copertiAdulti: richiesta.copertiAdulti,
          copertiBambini: richiesta.copertiBambini,
          formula: snapshot.codice,
        },
      });
      return creata;
    });
    return { seduta: riepilogoSeduta(seduta), tavoloId, pin };
  }

  /** New PIN for an open session. Devices already at the table keep their access. */
  async rigeneraPin(sedutaId: string, attore: Attore): Promise<SedutaConPin> {
    const pin = generaPin();
    const { seduta, tavoloId } = await this.eventi.transazione(async (tx, registro) => {
      const esistente = await this.sedutaAperta(tx, sedutaId);
      const tavoli = await tx.sedutaTavolo.findMany({ where: { sedutaId, alIl: null } });
      await this.blocchi.azzera(
        tx,
        tavoli.map((t) => chiaveTavolo(t.tavoloId)),
      );
      const aggiornata = await tx.seduta.update({
        where: { id: esistente.id },
        data: { pinHash: hmacPin(this.segretoPin, sedutaId, pin), pinGeneratoIl: new Date() },
        include: includeSeduta,
      });
      const tavoloId = tavoli[0]?.tavoloId ?? null;
      await registro.registra({ tipo: 'PIN_RIGENERATO', attore, sedutaId, tavoloId });
      return { seduta: aggiornata, tavoloId };
    });
    return { seduta: riepilogoSeduta(seduta), tavoloId: tavoloId ?? '', pin };
  }

  /**
   * Minimal closing (the full flow with the pre-bill comes in F4): frees the tables and
   * revokes every customer device, so their tokens stop working at once.
   */
  async chiudi(sedutaId: string, attore: Attore): Promise<void> {
    await this.eventi.transazione(async (tx, registro) => {
      await this.sedutaAperta(tx, sedutaId);
      const ora = new Date();
      const tavoli = await tx.sedutaTavolo.findMany({
        where: { sedutaId, alIl: null },
        include: { tavolo: { select: { numero: true } } },
      });
      await tx.seduta.update({
        where: { id: sedutaId },
        data: { stato: 'CHIUSA', chiusaIl: ora, chiusaDaId: attore.id },
      });
      await tx.sedutaTavolo.updateMany({ where: { sedutaId, alIl: null }, data: { alIl: ora } });
      await tx.tavolo.updateMany({ where: { sedutaCorrenteId: sedutaId }, data: { sedutaCorrenteId: null } });
      await tx.dispositivoCliente.updateMany({ where: { sedutaId, revocatoIl: null }, data: { revocatoIl: ora } });
      await registro.registra({
        tipo: 'TAVOLO_CHIUSO',
        attore,
        sedutaId,
        tavoloId: tavoli[0]?.tavoloId ?? null,
        payload: { tavoli: tavoli.map((t) => t.tavolo.numero) },
      });
    });
  }

  private async sedutaAperta(tx: Tx, sedutaId: string) {
    const seduta = await tx.seduta.findUnique({ where: { id: sedutaId } });
    if (!seduta) throw new NotFoundException({ codice: 'SEDUTA_INESISTENTE' });
    if (seduta.stato !== 'APERTA') throw new ConflictException({ codice: 'SEDUTA_CHIUSA' });
    return seduta;
  }
}
