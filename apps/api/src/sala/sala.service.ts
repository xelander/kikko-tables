import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ContestoGiro,
  type ErroreGiroDto,
  type FormulaSnapshot,
  type GiroDto,
  type SedutaClienteDto,
  type VoceCarrelloDto,
  aggregaVoci,
  calcolaScadenza,
  soloExtra,
  validaGiro,
} from '@kikko/shared';
import type { ClienteAutenticato } from '../cliente/cliente.service.js';
import type { Attore } from '../common/attore.js';
import { tokenCasuale, sha256 } from '../common/crypto.js';
import { conRiprova } from '../common/serializzabile.js';
import { EventiService, type Tx } from '../eventi/eventi.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { MenuService } from '../menu/menu.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const includeGiro = { voci: { select: { piattoId: true, quantita: true } } } satisfies Prisma.GiroInclude;
type GiroConVoci = Prisma.GiroGetPayload<{ include: typeof includeGiro }>;

export function giroDto(g: GiroConVoci): GiroDto {
  return {
    id: g.id,
    numero: g.numero,
    stato: g.stato,
    soloExtra: g.soloExtra,
    inviatoIl: g.inviatoIl.toISOString(),
    motivoRifiuto: g.motivoRifiuto,
    voci: g.voci.map((v) => ({ piattoId: v.piattoId, quantita: v.quantita })),
  };
}

/** Who is ordering: a customer's phone, or a staff member ordering on behalf of the table. */
export interface Ordinante {
  sedutaId: string;
  dispositivo: { id: string; soprannome: string; emoji: string };
  attore: Attore;
}

export function ordinanteCliente(c: ClienteAutenticato): Ordinante {
  return {
    sedutaId: c.seduta.id,
    dispositivo: { id: c.dispositivo.id, soprannome: c.dispositivo.soprannome, emoji: c.dispositivo.emoji },
    attore: { ruolo: 'CLIENTE', id: c.dispositivo.id },
  };
}

/** Emoji of the device a staff member uses to order for a table. */
export const EMOJI_STAFF = '🧑‍🍳';

/**
 * The table's shared cart and rounds (CLAUDE.md §3–4).
 * The cart has one line per dish per device; anyone at the table can send the round,
 * and the server re-checks every rule in a Serializable transaction.
 */
@Injectable()
export class SalaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventi: EventiService,
    private readonly menu: MenuService,
  ) {}

  /**
   * The device a staff member uses to order for a table: created on first use, never given a usable token.
   * Its lines appear in the shared cart with the chef emoji, so customers see what the waiter added.
   */
  async ordinanteStaff(sedutaId: string, utente: { id: string; nome: string }, attore: Attore): Promise<Ordinante> {
    const seduta = await this.prisma.seduta.findUnique({ where: { id: sedutaId } });
    if (!seduta) throw new NotFoundException({ codice: 'SEDUTA_INESISTENTE' });
    if (seduta.stato !== 'APERTA') throw new HttpException({ codice: 'SEDUTA_CHIUSA' }, HttpStatus.CONFLICT);
    const esistente = await this.prisma.dispositivoCliente.findFirst({
      where: { sedutaId, utenteStaffId: utente.id, revocatoIl: null },
    });
    const dispositivo =
      esistente ??
      (await this.prisma.dispositivoCliente.create({
        data: {
          sedutaId,
          utenteStaffId: utente.id,
          tokenHash: sha256(tokenCasuale()),
          soprannome: utente.nome,
          emoji: EMOJI_STAFF,
        },
      }));
    return {
      sedutaId,
      dispositivo: { id: dispositivo.id, soprannome: dispositivo.soprannome, emoji: dispositivo.emoji },
      attore,
    };
  }

  async stato(chi: Ordinante): Promise<SedutaClienteDto> {
    const sedutaId = chi.sedutaId;
    const [seduta, dispositivi, carrello, giri, tavoli] = await Promise.all([
      this.prisma.seduta.findUniqueOrThrow({ where: { id: sedutaId } }),
      this.prisma.dispositivoCliente.findMany({
        where: { sedutaId, revocatoIl: null },
        orderBy: { creatoIl: 'asc' },
        select: { id: true, soprannome: true, emoji: true },
      }),
      this.carrello(this.prisma, sedutaId),
      this.prisma.giro.findMany({ where: { sedutaId }, orderBy: { numero: 'asc' }, include: includeGiro }),
      this.prisma.sedutaTavolo.findMany({
        where: { sedutaId, alIl: null },
        include: { tavolo: { select: { numero: true } } },
      }),
    ]);
    const formula = seduta.formulaSnapshot as unknown as FormulaSnapshot;
    const io = chi.dispositivo;
    return {
      sedutaId,
      ora: new Date().toISOString(),
      tavoli: tavoli.map((t) => t.tavolo.numero).sort((a, b) => a - b),
      copertiAdulti: seduta.copertiAdulti,
      copertiBambini: seduta.copertiBambini,
      formula: {
        nome: formula.nome,
        piattiPerPersonaPerGiro: formula.piattiPerPersonaPerGiro,
        minutiTraGiri: formula.minutiTraGiri,
        durataMaxMinuti: formula.durataMaxMinuti,
        maxGiri: formula.maxGiri,
      },
      apertaIl: seduta.apertaIl.toISOString(),
      minutiExtra: seduta.minutiExtra,
      scadeIl: calcolaScadenza(seduta.apertaIl, formula.durataMaxMinuti, seduta.minutiExtra).toISOString(),
      io: { id: io.id, soprannome: io.soprannome, emoji: io.emoji },
      dispositivi,
      carrello,
      giri: giri.map(giroDto),
    };
  }

  /** Sets this device's quantity of a dish in the shared cart (0 removes the line). */
  async impostaVoce(chi: Ordinante, piattoId: string, quantita: number): Promise<VoceCarrelloDto[]> {
    const sedutaId = chi.sedutaId;
    const dispositivoId = chi.dispositivo.id;
    return this.eventi.transazione(async (tx, registro) => {
      const piatto = await tx.piatto.findUnique({ where: { id: piattoId }, select: { id: true } });
      if (!piatto) throw new NotFoundException({ codice: 'PIATTO_INESISTENTE' });
      const chiave = { sedutaId_piattoId_dispositivoId: { sedutaId, piattoId, dispositivoId } };
      const attuale = await tx.voceCarrello.findUnique({ where: chiave });
      if ((attuale?.quantita ?? 0) !== quantita) {
        if (quantita === 0) await tx.voceCarrello.delete({ where: chiave });
        else
          await tx.voceCarrello.upsert({
            where: chiave,
            create: { sedutaId, piattoId, dispositivoId, quantita },
            update: { quantita },
          });
        await registro.registra({
          tipo: 'CARRELLO_MODIFICATO',
          attore: chi.attore,
          sedutaId,
          payload: { piattoId, quantita, dispositivoId },
        });
      }
      return this.carrello(tx, sedutaId);
    });
  }

  /**
   * Sends the whole cart of the table as a new round.
   * Idempotent: the same key always returns the same round (a double tap or a retry after a network
   * error never creates a duplicate). Concurrent sends from two phones are serialised by PostgreSQL.
   */
  async inviaGiro(chi: Ordinante, chiaveIdempotenza: string): Promise<{ giro: GiroDto; nuovo: boolean }> {
    const sedutaId = chi.sedutaId;
    const esistente = await this.giroPerChiave(sedutaId, chiaveIdempotenza);
    if (esistente) return { giro: esistente, nuovo: false };

    try {
      return await conRiprova(() =>
        this.eventi.transazione(
          async (tx, registro) => {
            const giaInviato = await tx.giro.findUnique({
              where: { sedutaId_chiaveIdempotenza: { sedutaId, chiaveIdempotenza } },
              include: includeGiro,
            });
            if (giaInviato) return { giro: giroDto(giaInviato), nuovo: false };

            const seduta = await tx.seduta.findUniqueOrThrow({ where: { id: sedutaId } });
            if (seduta.stato !== 'APERTA') throw new HttpException({ codice: 'SEDUTA_CHIUSA' }, HttpStatus.CONFLICT);
            const formula = seduta.formulaSnapshot as unknown as FormulaSnapshot;
            const [righe, giri, regole] = await Promise.all([
              tx.voceCarrello.findMany({ where: { sedutaId } }),
              tx.giro.findMany({ where: { sedutaId }, include: includeGiro }),
              this.menu.regole(tx),
            ]);
            const voci = aggregaVoci(righe);
            const ctx: ContestoGiro = {
              formula,
              coperti: seduta.copertiAdulti + seduta.copertiBambini,
              apertaIl: seduta.apertaIl,
              minutiExtra: seduta.minutiExtra,
              ora: new Date(),
              giri,
              piatti: regole.piatti,
              gruppi: regole.gruppi,
            };
            const errori = validaGiro(ctx, voci);
            if (errori.length > 0) {
              const corpo: ErroreGiroDto = { codice: 'REGOLE_VIOLATE', errori };
              throw new HttpException(corpo, HttpStatus.UNPROCESSABLE_ENTITY);
            }

            const giro = await tx.giro.create({
              data: {
                sedutaId,
                numero: giri.length + 1,
                chiaveIdempotenza,
                soloExtra: soloExtra(ctx, voci),
                inviatoIl: ctx.ora,
                inviatoDaId: chi.dispositivo.id,
                voci: {
                  create: voci.map((v) => {
                    const p = regole.piatti.get(v.piattoId)!;
                    return {
                      piattoId: v.piattoId,
                      quantita: v.quantita,
                      inFormula: p.inFormula,
                      prezzoExtraCent: p.inFormula ? null : p.prezzoExtraCent,
                    };
                  }),
                },
              },
              include: includeGiro,
            });
            await tx.voceCarrello.deleteMany({ where: { sedutaId } });
            const tavolo = await tx.sedutaTavolo.findFirst({ where: { sedutaId, alIl: null } });
            await registro.registra({
              tipo: 'GIRO_INVIATO',
              attore: chi.attore,
              sedutaId,
              tavoloId: tavolo?.tavoloId ?? null,
              payload: {
                giroId: giro.id,
                numero: giro.numero,
                soloExtra: giro.soloExtra,
                pezzi: voci.reduce((t, v) => t + v.quantita, 0),
              },
            });
            return { giro: giroDto(giro), nuovo: true };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
        ),
      );
    } catch (error) {
      // Two requests with the same key raced: the other one won, return its round.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const vincitore = await this.giroPerChiave(sedutaId, chiaveIdempotenza);
        if (vincitore) return { giro: vincitore, nuovo: false };
      }
      throw error;
    }
  }

  private async giroPerChiave(sedutaId: string, chiaveIdempotenza: string): Promise<GiroDto | null> {
    const giro = await this.prisma.giro.findUnique({
      where: { sedutaId_chiaveIdempotenza: { sedutaId, chiaveIdempotenza } },
      include: includeGiro,
    });
    return giro ? giroDto(giro) : null;
  }

  private async carrello(db: Tx | PrismaService, sedutaId: string): Promise<VoceCarrelloDto[]> {
    const righe = await db.voceCarrello.findMany({
      where: { sedutaId },
      orderBy: { aggiornatoIl: 'asc' },
      select: { piattoId: true, dispositivoId: true, quantita: true },
    });
    return righe;
  }
}
