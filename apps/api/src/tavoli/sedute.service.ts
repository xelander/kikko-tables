import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ApriTavoloRichiesta,
  type CopertiRichiesta,
  type FormulaSnapshot,
  type SedutaConPin,
  type SedutaDettaglioDto,
  type SedutaRiepilogo,
  type TavoloStato,
  calcolaScadenza,
  creaSnapshotFormula,
} from '@kikko/shared';
import { giroDto } from '../sala/sala.service.js';
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
  dispositivi: { where: { revocatoIl: null, utenteStaffId: null }, select: { id: true } },
  tavoli: { where: { alIl: null }, select: { tavolo: { select: { numero: true } } } },
  giri: { select: { stato: true, inviatoIl: true } },
  carrello: { select: { quantita: true } },
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
    tavoli: s.tavoli.map((t) => t.tavolo.numero).sort((a, b) => a - b),
    giriInAttesa: s.giri.filter((g) => g.stato === 'INVIATO').length,
    pezziNelCarrello: s.carrello.reduce((t, v) => t + v.quantita, 0),
    ultimoGiroIl: s.giri.length ? new Date(Math.max(...s.giri.map((g) => g.inviatoIl.getTime()))).toISOString() : null,
  };
}

/** Locks session rows (in id order, to avoid deadlocks) until the end of the transaction. */
async function bloccaSedute(tx: Tx, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT id FROM "Seduta" WHERE id = ${id}::uuid FOR UPDATE`;
  }
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

  /** Everything the waiter needs about an open table. */
  async dettaglio(sedutaId: string): Promise<SedutaDettaglioDto> {
    const seduta = await this.prisma.seduta.findUnique({
      where: { id: sedutaId },
      include: {
        apertaDa: { select: { nome: true } },
        tavoli: { where: { alIl: null }, include: { tavolo: true } },
        dispositivi: { where: { revocatoIl: null }, orderBy: { creatoIl: 'asc' } },
        carrello: { orderBy: { aggiornatoIl: 'asc' }, select: { piattoId: true, dispositivoId: true, quantita: true } },
        giri: { orderBy: { numero: 'asc' }, include: { voci: { select: { piattoId: true, quantita: true } } } },
      },
    });
    if (!seduta) throw new NotFoundException({ codice: 'SEDUTA_INESISTENTE' });
    const formula = seduta.formulaSnapshot as unknown as FormulaSnapshot;
    return {
      sedutaId: seduta.id,
      ora: new Date().toISOString(),
      tavoli: seduta.tavoli
        .map((t) => ({ id: t.tavolo.id, numero: t.tavolo.numero, slugQr: t.tavolo.slugQr }))
        .sort((a, b) => a.numero - b.numero),
      copertiAdulti: seduta.copertiAdulti,
      copertiBambini: seduta.copertiBambini,
      formula: {
        codice: formula.codice,
        nome: formula.nome,
        piattiPerPersonaPerGiro: formula.piattiPerPersonaPerGiro,
        minutiTraGiri: formula.minutiTraGiri,
        durataMaxMinuti: formula.durataMaxMinuti,
        maxGiri: formula.maxGiri,
      },
      apertaIl: seduta.apertaIl.toISOString(),
      apertaDa: seduta.apertaDa.nome,
      minutiExtra: seduta.minutiExtra,
      scadeIl: calcolaScadenza(seduta.apertaIl, formula.durataMaxMinuti, seduta.minutiExtra).toISOString(),
      pinGeneratoIl: seduta.pinGeneratoIl.toISOString(),
      dispositivi: seduta.dispositivi.map((d) => ({
        id: d.id,
        soprannome: d.soprannome,
        emoji: d.emoji,
        staff: d.utenteStaffId !== null,
      })),
      carrello: seduta.carrello,
      giri: seduta.giri.map(giroDto),
    };
  }

  /** Changes the covers: round and per-person limits follow; the formula rules stay those copied at opening. */
  async modificaCoperti(sedutaId: string, coperti: CopertiRichiesta, attore: Attore): Promise<SedutaRiepilogo> {
    const seduta = await this.eventi.transazione(async (tx, registro) => {
      await bloccaSedute(tx, [sedutaId]);
      await this.sedutaAperta(tx, sedutaId);
      const aggiornata = await tx.seduta.update({ where: { id: sedutaId }, data: coperti, include: includeSeduta });
      await registro.registra({
        tipo: 'COPERTI_MODIFICATI',
        attore,
        sedutaId,
        tavoloId: await this.tavoloPrincipale(tx, sedutaId),
        payload: { ...coperti, tavoli: aggiornata.tavoli.map((t) => t.tavolo.numero) },
      });
      return aggiornata;
    });
    return riepilogoSeduta(seduta);
  }

  /** Moves the session from one of its tables to a free table. Phones already at the table stay in. */
  async sposta(sedutaId: string, daTavoloId: string, aTavoloId: string, attore: Attore): Promise<SedutaRiepilogo> {
    if (daTavoloId === aTavoloId) throw new BadRequestException({ codice: 'STESSO_TAVOLO' });
    const seduta = await this.eventi.transazione(async (tx, registro) => {
      await bloccaSedute(tx, [sedutaId]);
      await this.sedutaAperta(tx, sedutaId);
      const da = await tx.sedutaTavolo.findUnique({
        where: { sedutaId_tavoloId: { sedutaId, tavoloId: daTavoloId } },
        include: { tavolo: true },
      });
      if (!da || da.alIl) throw new BadRequestException({ codice: 'TAVOLO_NON_DELLA_SEDUTA' });
      const a = await this.occupaTavoloLibero(tx, aTavoloId, sedutaId);
      const ora = new Date();
      await tx.sedutaTavolo.update({
        where: { sedutaId_tavoloId: { sedutaId, tavoloId: daTavoloId } },
        data: { alIl: ora },
      });
      await tx.tavolo.update({ where: { id: daTavoloId }, data: { sedutaCorrenteId: null } });
      await this.blocchi.azzera(tx, [chiaveTavolo(daTavoloId)]);
      const aggiornata = await tx.seduta.findUniqueOrThrow({ where: { id: sedutaId }, include: includeSeduta });
      await registro.registra({
        tipo: 'TAVOLO_SPOSTATO',
        attore,
        sedutaId,
        tavoloId: aTavoloId,
        payload: {
          tavoloNumero: a.numero,
          daNumero: da.tavolo.numero,
          tavoli: aggiornata.tavoli.map((t) => t.tavolo.numero),
        },
      });
      return aggiornata;
    });
    return riepilogoSeduta(seduta);
  }

  /** Adds a free table to an open session: the QR codes of all its tables lead to the same session. */
  async aggiungiTavolo(sedutaId: string, tavoloId: string, attore: Attore): Promise<SedutaRiepilogo> {
    const seduta = await this.eventi.transazione(async (tx, registro) => {
      await bloccaSedute(tx, [sedutaId]);
      await this.sedutaAperta(tx, sedutaId);
      const tavolo = await this.occupaTavoloLibero(tx, tavoloId, sedutaId);
      const aggiornata = await tx.seduta.findUniqueOrThrow({ where: { id: sedutaId }, include: includeSeduta });
      await registro.registra({
        tipo: 'TAVOLI_UNITI',
        attore,
        sedutaId,
        tavoloId,
        payload: { tavoli: aggiornata.tavoli.map((t) => t.tavolo.numero), aggiunto: tavolo.numero },
      });
      return aggiornata;
    });
    return riepilogoSeduta(seduta);
  }

  /**
   * Merges another open session (same formula) into this one: tables, phones, cart and rounds move here,
   * covers add up and the oldest opening time counts. The other session is closed as "merged".
   */
  async unisci(sedutaId: string, altraId: string, attore: Attore): Promise<SedutaRiepilogo> {
    if (sedutaId === altraId) throw new BadRequestException({ codice: 'STESSA_SEDUTA' });
    const seduta = await this.eventi.transazione(async (tx, registro) => {
      await bloccaSedute(tx, [sedutaId, altraId]);
      const principale = await this.sedutaAperta(tx, sedutaId);
      const altra = await this.sedutaAperta(tx, altraId);
      const fp = principale.formulaSnapshot as unknown as FormulaSnapshot;
      const fa = altra.formulaSnapshot as unknown as FormulaSnapshot;
      if (fp.codice !== fa.codice) throw new ConflictException({ codice: 'FORMULE_DIVERSE' });

      const ora = new Date();
      const tavoliAltra = await tx.sedutaTavolo.findMany({ where: { sedutaId: altraId, alIl: null } });
      await tx.sedutaTavolo.updateMany({ where: { sedutaId: altraId, alIl: null }, data: { alIl: ora } });
      for (const t of tavoliAltra) {
        await tx.sedutaTavolo.upsert({
          where: { sedutaId_tavoloId: { sedutaId, tavoloId: t.tavoloId } },
          create: { sedutaId, tavoloId: t.tavoloId },
          update: { alIl: null, dalIl: ora },
        });
      }
      await tx.tavolo.updateMany({ where: { sedutaCorrenteId: altraId }, data: { sedutaCorrenteId: sedutaId } });
      await tx.dispositivoCliente.updateMany({ where: { sedutaId: altraId }, data: { sedutaId } });
      await tx.voceCarrello.updateMany({ where: { sedutaId: altraId }, data: { sedutaId } });

      // Rounds keep counting for the per-person limits: renumber them after the main session's ones.
      const giriPrincipale = await tx.giro.count({ where: { sedutaId } });
      const giriAltra = await tx.giro.findMany({ where: { sedutaId: altraId }, orderBy: { inviatoIl: 'asc' } });
      for (const [i, g] of giriAltra.entries()) {
        await tx.giro.update({ where: { id: g.id }, data: { sedutaId, numero: giriPrincipale + i + 1 } });
      }

      await tx.seduta.update({
        where: { id: altraId },
        data: { stato: 'CHIUSA', chiusaIl: ora, chiusaDaId: attore.id, unitaInId: sedutaId },
      });
      const aggiornata = await tx.seduta.update({
        where: { id: sedutaId },
        data: {
          copertiAdulti: principale.copertiAdulti + altra.copertiAdulti,
          copertiBambini: principale.copertiBambini + altra.copertiBambini,
          apertaIl: principale.apertaIl < altra.apertaIl ? principale.apertaIl : altra.apertaIl,
          minutiExtra: Math.max(principale.minutiExtra, altra.minutiExtra),
        },
        include: includeSeduta,
      });
      await registro.registra({
        tipo: 'TAVOLI_UNITI',
        attore,
        sedutaId,
        tavoloId: await this.tavoloPrincipale(tx, sedutaId),
        payload: {
          tavoli: aggiornata.tavoli.map((t) => t.tavolo.numero),
          sedutaAssorbitaId: altraId,
          copertiAdulti: aggiornata.copertiAdulti,
          copertiBambini: aggiornata.copertiBambini,
        },
      });
      return aggiornata;
    });
    return riepilogoSeduta(seduta);
  }

  /** Takes a free, active table for the session (conditional update: safe with concurrent requests). */
  private async occupaTavoloLibero(tx: Tx, tavoloId: string, sedutaId: string) {
    const tavolo = await tx.tavolo.findUnique({ where: { id: tavoloId } });
    if (!tavolo || !tavolo.attivo) throw new NotFoundException({ codice: 'TAVOLO_INESISTENTE' });
    const preso = await tx.tavolo.updateMany({
      where: { id: tavoloId, sedutaCorrenteId: null },
      data: { sedutaCorrenteId: sedutaId },
    });
    if (preso.count === 0) throw new ConflictException({ codice: 'TAVOLO_OCCUPATO' });
    await tx.sedutaTavolo.upsert({
      where: { sedutaId_tavoloId: { sedutaId, tavoloId } },
      create: { sedutaId, tavoloId },
      update: { alIl: null, dalIl: new Date() },
    });
    await this.blocchi.azzera(tx, [chiaveTavolo(tavoloId)]);
    return tavolo;
  }

  private async tavoloPrincipale(tx: Tx, sedutaId: string): Promise<string | null> {
    const t = await tx.sedutaTavolo.findFirst({
      where: { sedutaId, alIl: null },
      include: { tavolo: { select: { numero: true } } },
      orderBy: { tavolo: { numero: 'asc' } },
    });
    return t?.tavoloId ?? null;
  }

  private async sedutaAperta(tx: Tx, sedutaId: string) {
    const seduta = await tx.seduta.findUnique({ where: { id: sedutaId } });
    if (!seduta) throw new NotFoundException({ codice: 'SEDUTA_INESISTENTE' });
    if (seduta.stato !== 'APERTA') throw new ConflictException({ codice: 'SEDUTA_CHIUSA' });
    return seduta;
  }
}
