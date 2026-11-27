import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CodaCassaDto,
  type EstensioneTuttiDto,
  type FormulaSnapshot,
  type GiroCassaDto,
  type PiattoCassaDto,
  type PrecontoDto,
  type TempoSedutaDto,
  calcolaPreconto,
  calcolaScadenza,
} from '@kikko/shared';
import type { Attore } from '../common/attore.js';
import { SISTEMA } from '../common/attore.js';
import { EventiService, type RegistroTx, type Tx } from '../eventi/eventi.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Handled rounds shown under the queue, for reference. */
const RECENTI = 10;
const FINESTRA_RECENTI_MS = 3 * 60 * 60_000;

const includeGiroCassa = {
  voci: { select: { piattoId: true, quantita: true, inFormula: true } },
  inviatoDa: { select: { soprannome: true, emoji: true } },
  seduta: {
    select: {
      copertiAdulti: true,
      copertiBambini: true,
      formulaSnapshot: true,
      tavoli: { select: { alIl: true, tavolo: { select: { numero: true } } } },
    },
  },
} satisfies Prisma.GiroInclude;
type GiroCassa = Prisma.GiroGetPayload<{ include: typeof includeGiroCassa }>;

/** Numbers of the tables a session is on now (or was on, once closed). */
function numeriTavoli(tavoli: { alIl: Date | null; tavolo: { numero: number } }[]): number[] {
  const correnti = tavoli.filter((t) => t.alIl === null);
  return (correnti.length > 0 ? correnti : tavoli).map((t) => t.tavolo.numero).sort((a, b) => a - b);
}

/**
 * The manager's tablet at the till (CLAUDE.md §3 steps 5–6, §4, §6):
 * round approval, sold-out dishes, extra time, pre-bill.
 * Every change is recorded in the event log in the same transaction.
 */
@Injectable()
export class CassaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventi: EventiService,
  ) {}

  // ---------- Rounds ----------

  async coda(): Promise<CodaCassaDto> {
    const ora = new Date();
    const [inAttesa, recenti] = await Promise.all([
      this.prisma.giro.findMany({
        where: { stato: 'INVIATO', seduta: { stato: 'APERTA' } },
        orderBy: { inviatoIl: 'asc' },
        include: includeGiroCassa,
      }),
      this.prisma.giro.findMany({
        where: {
          stato: { in: ['APPROVATO', 'RIFIUTATO'] },
          gestitoIl: { gte: new Date(ora.getTime() - FINESTRA_RECENTI_MS) },
        },
        orderBy: { gestitoIl: 'desc' },
        take: RECENTI,
        include: includeGiroCassa,
      }),
    ]);
    const idStaff = [...new Set(recenti.map((g) => g.gestitoDaId).filter((id): id is string => id !== null))];
    const staff = idStaff.length
      ? await this.prisma.utenteStaff.findMany({ where: { id: { in: idStaff } }, select: { id: true, nome: true } })
      : [];
    const nomi = new Map(staff.map((s) => [s.id, s.nome]));
    return {
      ora: ora.toISOString(),
      inAttesa: inAttesa.map((g) => this.giroDto(g, nomi)),
      recenti: recenti.map((g) => this.giroDto(g, nomi)),
    };
  }

  approva(giroId: string, attore: Attore): Promise<GiroCassaDto> {
    return this.gestisci(giroId, 'APPROVATO', null, attore);
  }

  /** A rejected round does not count for limits nor for the wait between rounds (rules ignore it). */
  rifiuta(giroId: string, motivo: string, attore: Attore): Promise<GiroCassaDto> {
    return this.gestisci(giroId, 'RIFIUTATO', motivo, attore);
  }

  private async gestisci(
    giroId: string,
    stato: 'APPROVATO' | 'RIFIUTATO',
    motivo: string | null,
    attore: Attore,
  ): Promise<GiroCassaDto> {
    const giro = await this.eventi.transazione(async (tx, registro) => {
      const attuale = await tx.giro.findUnique({ where: { id: giroId }, include: { seduta: true } });
      if (!attuale) throw new NotFoundException({ codice: 'GIRO_INESISTENTE' });
      if (attuale.seduta.stato !== 'APERTA') throw new ConflictException({ codice: 'SEDUTA_CHIUSA' });
      // Conditional update: when two tablets act on the same round, only the first one wins.
      const aggiornati = await tx.giro.updateMany({
        where: { id: giroId, stato: 'INVIATO' },
        data: { stato, gestitoDaId: attore.id, gestitoIl: new Date(), motivoRifiuto: motivo },
      });
      if (aggiornati.count === 0) {
        const ora = await tx.giro.findUniqueOrThrow({ where: { id: giroId }, select: { stato: true } });
        throw new ConflictException({ codice: 'GIRO_GIA_GESTITO', stato: ora.stato });
      }
      const aggiornato = await tx.giro.findUniqueOrThrow({ where: { id: giroId }, include: includeGiroCassa });
      const tavoli = numeriTavoli(aggiornato.seduta.tavoli);
      await registro.registra({
        tipo: stato === 'APPROVATO' ? 'GIRO_APPROVATO' : 'GIRO_RIFIUTATO',
        attore,
        sedutaId: aggiornato.sedutaId,
        tavoloId: await this.tavoloPrincipale(tx, aggiornato.sedutaId),
        payload: {
          giroId,
          numero: aggiornato.numero,
          tavoli,
          ...(motivo !== null ? { motivo } : {}),
        },
      });
      return aggiornato;
    });
    const nome = attore.id
      ? await this.prisma.utenteStaff.findUnique({ where: { id: attore.id }, select: { nome: true } })
      : null;
    return this.giroDto(giro, new Map(attore.id && nome ? [[attore.id, nome.nome]] : []));
  }

  private giroDto(g: GiroCassa, nomiStaff: ReadonlyMap<string, string>): GiroCassaDto {
    const formula = g.seduta.formulaSnapshot as unknown as FormulaSnapshot;
    return {
      id: g.id,
      sedutaId: g.sedutaId,
      numero: g.numero,
      stato: g.stato,
      soloExtra: g.soloExtra,
      inviatoIl: g.inviatoIl.toISOString(),
      gestitoIl: g.gestitoIl?.toISOString() ?? null,
      gestitoDa: g.gestitoDaId ? (nomiStaff.get(g.gestitoDaId) ?? null) : null,
      motivoRifiuto: g.motivoRifiuto,
      tavoli: numeriTavoli(g.seduta.tavoli),
      formula: formula.nome.it,
      coperti: g.seduta.copertiAdulti + g.seduta.copertiBambini,
      inviatoDa: g.inviatoDa,
      voci: g.voci,
    };
  }

  // ---------- Sold-out dishes ----------

  async piatti(): Promise<PiattoCassaDto[]> {
    const piatti = await this.prisma.piatto.findMany({
      include: { categoria: { select: { nomeIt: true, ordine: true } } },
      orderBy: [{ categoria: { ordine: 'asc' } }, { ordine: 'asc' }, { nomeIt: 'asc' }],
    });
    return piatti.map((p) => this.piattoDto(p));
  }

  /** Sold out or available again: open menus update at once through the event. */
  async disponibilita(piattoId: string, disponibile: boolean, attore: Attore): Promise<PiattoCassaDto> {
    return this.eventi.transazione(async (tx, registro) => {
      const piatto = await tx.piatto.findUnique({
        where: { id: piattoId },
        include: { categoria: { select: { nomeIt: true, ordine: true } } },
      });
      if (!piatto) throw new NotFoundException({ codice: 'PIATTO_INESISTENTE' });
      if (piatto.disponibile === disponibile) return this.piattoDto(piatto);
      const aggiornato = await tx.piatto.update({
        where: { id: piattoId },
        data: { disponibile },
        include: { categoria: { select: { nomeIt: true, ordine: true } } },
      });
      await registro.registra({
        tipo: disponibile ? 'PIATTO_RIPRISTINATO' : 'PIATTO_ESAURITO',
        attore,
        payload: { piattoId, nome: piatto.nomeIt, numero: piatto.numero },
      });
      return this.piattoDto(aggiornato);
    });
  }

  private piattoDto(p: {
    id: string;
    numero: string | null;
    nomeIt: string;
    inFormula: boolean;
    disponibile: boolean;
    categoria: { nomeIt: string };
  }): PiattoCassaDto {
    return {
      id: p.id,
      numero: p.numero,
      nome: p.nomeIt,
      categoria: p.categoria.nomeIt,
      inFormula: p.inFormula,
      disponibile: p.disponibile,
    };
  }

  // ---------- Time ----------

  /** Extra minutes for one table (e.g. a late table, or a table that lost time). */
  async estendi(sedutaId: string, minuti: number, attore: Attore): Promise<TempoSedutaDto> {
    return this.eventi.transazione(async (tx, registro) => {
      await tx.$queryRaw`SELECT id FROM "Seduta" WHERE id = ${sedutaId}::uuid FOR UPDATE`;
      const seduta = await tx.seduta.findUnique({ where: { id: sedutaId } });
      if (!seduta) throw new NotFoundException({ codice: 'SEDUTA_INESISTENTE' });
      if (seduta.stato !== 'APERTA') throw new ConflictException({ codice: 'SEDUTA_CHIUSA' });
      return this.aggiungiMinuti(tx, registro, seduta, minuti, attore, false);
    });
  }

  /** "Extend time for every open table" (CLAUDE.md §6): to give back the time lost in a blackout. */
  async estendiTutti(minuti: number, attore: Attore): Promise<EstensioneTuttiDto> {
    return this.eventi.transazione(async (tx, registro) => {
      const aperte = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Seduta" WHERE stato = 'APERTA' ORDER BY id FOR UPDATE`;
      const sedute = await tx.seduta.findMany({ where: { id: { in: aperte.map((a) => a.id) } } });
      for (const seduta of sedute) await this.aggiungiMinuti(tx, registro, seduta, minuti, attore, true);
      return { sedute: sedute.length };
    });
  }

  private async aggiungiMinuti(
    tx: Tx,
    registro: RegistroTx,
    seduta: { id: string; apertaIl: Date; minutiExtra: number; formulaSnapshot: unknown },
    minuti: number,
    attore: Attore,
    tutti: boolean,
  ): Promise<TempoSedutaDto> {
    const formula = seduta.formulaSnapshot as FormulaSnapshot;
    const minutiExtra = seduta.minutiExtra + minuti;
    const scadeIl = calcolaScadenza(seduta.apertaIl, formula.durataMaxMinuti, minutiExtra);
    await tx.seduta.update({
      where: { id: seduta.id },
      // Back in time: the expiry alarm may fire again when the new deadline passes.
      data: { minutiExtra, ...(scadeIl > new Date() ? { scadutaNotificataIl: null } : {}) },
    });
    await registro.registra({
      tipo: 'TEMPO_ESTESO',
      attore,
      sedutaId: seduta.id,
      tavoloId: await this.tavoloPrincipale(tx, seduta.id),
      payload: { minuti, minutiExtra, scadeIl: scadeIl.toISOString(), tutti, tavoli: await this.numeri(tx, seduta.id) },
    });
    return { sedutaId: seduta.id, minutiExtra, scadeIl: scadeIl.toISOString() };
  }

  /**
   * Records TEMPO_SCADUTO once for each open session past its maximum duration.
   * The session is not closed (CLAUDE.md §4): it can no longer send rounds and the till gets an alarm.
   * Returns how many sessions were flagged.
   */
  async controllaScadenze(ora = new Date()): Promise<number> {
    const aperte = await this.prisma.seduta.findMany({
      where: { stato: 'APERTA', scadutaNotificataIl: null },
      select: { id: true, apertaIl: true, minutiExtra: true, formulaSnapshot: true },
    });
    let segnalate = 0;
    for (const s of aperte) {
      const formula = s.formulaSnapshot as unknown as FormulaSnapshot;
      const scadeIl = calcolaScadenza(s.apertaIl, formula.durataMaxMinuti, s.minutiExtra);
      if (scadeIl > ora) continue;
      const fatto = await this.eventi.transazione(async (tx, registro) => {
        // Conditional update: only one check (or one server) records the event.
        const preso = await tx.seduta.updateMany({
          where: { id: s.id, stato: 'APERTA', scadutaNotificataIl: null, minutiExtra: s.minutiExtra },
          data: { scadutaNotificataIl: ora },
        });
        if (preso.count === 0) return false;
        await registro.registra({
          tipo: 'TEMPO_SCADUTO',
          attore: SISTEMA,
          sedutaId: s.id,
          tavoloId: await this.tavoloPrincipale(tx, s.id),
          payload: { scadeIl: scadeIl.toISOString(), tavoli: await this.numeri(tx, s.id) },
        });
        return true;
      });
      if (fatto) segnalate++;
    }
    return segnalate;
  }

  // ---------- Pre-bill ----------

  /** Informational pre-bill (not a fiscal receipt, CLAUDE.md §9). Recorded as PRECONTO_GENERATO. */
  async preconto(sedutaId: string, attore: Attore): Promise<PrecontoDto> {
    return this.eventi.transazione(async (tx, registro) => {
      const seduta = await tx.seduta.findUnique({
        where: { id: sedutaId },
        include: {
          tavoli: { select: { alIl: true, tavolo: { select: { numero: true } } } },
          giri: {
            select: {
              stato: true,
              voci: { select: { piattoId: true, quantita: true, inFormula: true, prezzoExtraCent: true } },
            },
          },
        },
      });
      if (!seduta) throw new NotFoundException({ codice: 'SEDUTA_INESISTENTE' });
      const formula = seduta.formulaSnapshot as unknown as FormulaSnapshot;
      const idExtra = [
        ...new Set(seduta.giri.flatMap((g) => g.voci.filter((v) => !v.inFormula).map((v) => v.piattoId))),
      ];
      const [piatti, impostazioni] = await Promise.all([
        tx.piatto.findMany({ where: { id: { in: idExtra } }, select: { id: true, nomeIt: true } }),
        tx.impostazioni.findUnique({ where: { id: 1 } }),
      ]);
      const conto = calcolaPreconto({
        formula: {
          nome: formula.nome.it,
          prezzoAdultoCent: formula.prezzoAdultoCent,
          prezzoBambinoCent: formula.prezzoBambinoCent,
        },
        copertiAdulti: seduta.copertiAdulti,
        copertiBambini: seduta.copertiBambini,
        giri: seduta.giri,
        nomi: new Map(piatti.map((p) => [p.id, p.nomeIt])),
      });
      const tavoli = numeriTavoli(seduta.tavoli);
      const generatoIl = new Date();
      await registro.registra({
        tipo: 'PRECONTO_GENERATO',
        attore,
        sedutaId,
        tavoloId: await this.tavoloPrincipale(tx, sedutaId),
        payload: { tavoli, totaleCent: conto.totaleCent, giriInAttesa: conto.giriInAttesa },
      });
      return {
        sedutaId,
        nomeLocale: impostazioni?.nomeLocale ?? 'Kikko',
        valuta: impostazioni?.valuta ?? 'EUR',
        tavoli,
        formula: formula.nome.it,
        apertaIl: seduta.apertaIl.toISOString(),
        generatoIl: generatoIl.toISOString(),
        copertiAdulti: seduta.copertiAdulti,
        copertiBambini: seduta.copertiBambini,
        ...conto,
      };
    });
  }

  // ---------- helpers ----------

  private async tavoloPrincipale(tx: Tx, sedutaId: string): Promise<string | null> {
    const t = await tx.sedutaTavolo.findFirst({
      where: { sedutaId, alIl: null },
      orderBy: { tavolo: { numero: 'asc' } },
    });
    return t?.tavoloId ?? null;
  }

  private async numeri(tx: Tx, sedutaId: string): Promise<number[]> {
    const tavoli = await tx.sedutaTavolo.findMany({
      where: { sedutaId },
      select: { alIl: true, tavolo: { select: { numero: true } } },
    });
    return numeriTavoli(tavoli);
  }
}
