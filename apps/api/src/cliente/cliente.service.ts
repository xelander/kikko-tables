import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DispositivoClienteDto, FormulaSnapshot, StatoTavoloCliente } from '@kikko/shared';
import { calcolaScadenza } from '@kikko/shared';
import { hmacPin, sha256, tokenCasuale, uguali } from '../common/crypto.js';
import type { Env } from '../config/env.js';
import { EventiService } from '../eventi/eventi.service.js';
import type { DispositivoCliente, Seduta } from '../generated/prisma/client.js';
import { BlocchiService, chiaveDispositivo, chiaveIp, chiaveTavolo } from '../pin/blocchi.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Emojis given to the devices of a table, in order, so everyone can tell who added what. */
export const EMOJI_DISPOSITIVI = [
  '🐼',
  '🦊',
  '🐯',
  '🐸',
  '🐙',
  '🦄',
  '🐧',
  '🐨',
  '🦁',
  '🐵',
  '🐰',
  '🐻',
  '🐹',
  '🐮',
  '🐷',
  '🐔',
  '🐳',
  '🦋',
  '🐢',
  '🦉',
  '🐝',
  '🦀',
  '🐬',
  '🦒',
] as const;

/** Who is trying a PIN: the anonymous device cookie when present, otherwise the IP address. */
export interface Richiedente {
  idDispositivo: string | null;
  ip: string;
}

export interface ClienteAutenticato {
  dispositivo: DispositivoCliente;
  seduta: Seduta;
}

export interface EsitoJoin {
  token: string;
  dispositivo: DispositivoClienteDto;
}

/** Customer access through the table QR code and PIN (CLAUDE.md §3 and §5). */
@Injectable()
export class ClienteService {
  private readonly segretoPin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventi: EventiService,
    private readonly blocchi: BlocchiService,
    config: ConfigService<Env, true>,
  ) {
    this.segretoPin = config.get('PIN_HMAC_SECRET', { infer: true });
  }

  /** Validates a customer token: the device must not be revoked and its session must be open. */
  async autentica(token: string | null): Promise<ClienteAutenticato | null> {
    if (!token) return null;
    const dispositivo = await this.prisma.dispositivoCliente.findUnique({
      where: { tokenHash: sha256(token) },
      include: { seduta: true },
    });
    if (!dispositivo || dispositivo.revocatoIl || dispositivo.seduta.stato !== 'APERTA') return null;
    const { seduta, ...resto } = dispositivo;
    return { dispositivo: resto, seduta };
  }

  async stato(slug: string, token: string | null, chi: Richiedente): Promise<StatoTavoloCliente> {
    const tavolo = await this.prisma.tavolo.findUnique({ where: { slugQr: slug } });
    if (!tavolo || !tavolo.attivo) throw new NotFoundException({ codice: 'TAVOLO_INESISTENTE' });
    const info = { numero: tavolo.numero };

    const cliente = await this.autentica(token);
    if (cliente && (await this.appartiene(cliente.seduta.id, tavolo.id, tavolo.sedutaCorrenteId))) {
      await this.prisma.dispositivoCliente.update({
        where: { id: cliente.dispositivo.id },
        data: { ultimoAccesso: new Date() },
      });
      return this.connesso(cliente.seduta, cliente.dispositivo);
    }
    if (!tavolo.sedutaCorrenteId) return { stato: 'NON_ATTIVO', tavolo: info };

    const bloccato = await this.prisma.$transaction((tx) =>
      this.blocchi.secondiBlocco(tx, this.chiavi(tavolo.id, chi), new Date()),
    );
    return { stato: 'PIN_RICHIESTO', tavolo: info, bloccatoPerSecondi: bloccato };
  }

  /**
   * Checks the PIN and admits the device to the session.
   * Wrong PINs are counted per device/IP and per table; each one is recorded as PIN_ERRATO.
   */
  async unisciti(slug: string, pin: string, soprannome: string | undefined, chi: Richiedente): Promise<EsitoJoin> {
    const tavolo = await this.prisma.tavolo.findUnique({ where: { slugQr: slug } });
    if (!tavolo || !tavolo.attivo) throw new NotFoundException({ codice: 'TAVOLO_INESISTENTE' });
    const chiavi = this.chiavi(tavolo.id, chi);
    const ora = new Date();

    type Esito =
      | { tipo: 'ok'; esito: EsitoJoin }
      | { tipo: 'errato'; tentativiRimasti: number; secondiBlocco: number }
      | { tipo: 'bloccato'; secondi: number }
      | { tipo: 'non_attivo' };

    const risultato = await this.eventi.transazione<Esito>(async (tx, registro) => {
      await this.blocchi.blocca(tx, chiavi);
      const bloccato = await this.blocchi.secondiBlocco(tx, chiavi, ora);
      if (bloccato > 0) return { tipo: 'bloccato', secondi: bloccato };

      const attuale = await tx.tavolo.findUnique({ where: { id: tavolo.id }, include: { sedutaCorrente: true } });
      const seduta = attuale?.sedutaCorrente;
      if (!seduta || seduta.stato !== 'APERTA') return { tipo: 'non_attivo' };

      if (!uguali(hmacPin(this.segretoPin, seduta.id, pin), seduta.pinHash)) {
        const esito = await this.blocchi.registraFallimento(tx, chiavi, ora);
        await registro.registra({
          tipo: 'PIN_ERRATO',
          attore: { ruolo: 'CLIENTE', id: null },
          sedutaId: seduta.id,
          tavoloId: tavolo.id,
          payload: {
            tavoloNumero: tavolo.numero,
            ip: chi.ip,
            tentativiRimasti: esito.tentativiRimasti,
            bloccatoPerSecondi: esito.secondiBlocco,
          },
        });
        return { tipo: 'errato', ...esito };
      }

      await this.blocchi.azzera(tx, chiavi);
      const presenti = await tx.dispositivoCliente.findMany({
        where: { sedutaId: seduta.id },
        select: { emoji: true },
      });
      const usate = new Set(presenti.map((p) => p.emoji));
      const emoji =
        EMOJI_DISPOSITIVI.find((e) => !usate.has(e)) ?? EMOJI_DISPOSITIVI[presenti.length % EMOJI_DISPOSITIVI.length]!;
      const token = tokenCasuale();
      const dispositivo = await tx.dispositivoCliente.create({
        data: {
          sedutaId: seduta.id,
          tokenHash: sha256(token),
          emoji,
          soprannome: soprannome?.trim() || `Ospite ${presenti.length + 1}`,
        },
      });
      await registro.registra({
        tipo: 'DISPOSITIVO_UNITO',
        attore: { ruolo: 'CLIENTE', id: dispositivo.id },
        sedutaId: seduta.id,
        tavoloId: tavolo.id,
        payload: {
          dispositivoId: dispositivo.id,
          soprannome: dispositivo.soprannome,
          emoji,
          tavoloNumero: tavolo.numero,
        },
      });
      return { tipo: 'ok', esito: { token, dispositivo: dtoDispositivo(dispositivo) } };
    });

    switch (risultato.tipo) {
      case 'ok':
        return risultato.esito;
      case 'non_attivo':
        throw new ConflictException({ codice: 'NON_ATTIVO' });
      case 'bloccato':
        throw new HttpException(
          { codice: 'BLOCCATO', riprovaTraSecondi: risultato.secondi },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'errato':
        if (risultato.secondiBlocco > 0) {
          throw new HttpException(
            { codice: 'BLOCCATO', riprovaTraSecondi: risultato.secondiBlocco },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new UnauthorizedException({ codice: 'PIN_ERRATO', tentativiRimasti: risultato.tentativiRimasti });
    }
  }

  /**
   * A device stays at its table when the session moves or is merged: the QR code it scanned keeps working
   * if the table is (or was) one of its session's tables.
   */
  private async appartiene(sedutaId: string, tavoloId: string, sedutaCorrenteId: string | null): Promise<boolean> {
    if (sedutaCorrenteId === sedutaId) return true;
    if (sedutaCorrenteId !== null) return false;
    const storico = await this.prisma.sedutaTavolo.findUnique({ where: { sedutaId_tavoloId: { sedutaId, tavoloId } } });
    return storico !== null;
  }

  private async connesso(seduta: Seduta, dispositivo: DispositivoCliente): Promise<StatoTavoloCliente> {
    const formula = seduta.formulaSnapshot as unknown as FormulaSnapshot;
    const principale = await this.prisma.sedutaTavolo.findFirst({
      where: { sedutaId: seduta.id, alIl: null },
      include: { tavolo: { select: { numero: true } } },
      orderBy: { tavolo: { numero: 'asc' } },
    });
    return {
      stato: 'CONNESSO',
      tavolo: { numero: principale?.tavolo.numero ?? 0 },
      sedutaId: seduta.id,
      dispositivo: dtoDispositivo(dispositivo),
      scadeIl: calcolaScadenza(seduta.apertaIl, formula.durataMaxMinuti, seduta.minutiExtra).toISOString(),
      formula: { nome: formula.nome },
    };
  }

  private chiavi(tavoloId: string, chi: Richiedente): string[] {
    const richiedente = chi.idDispositivo ? chiaveDispositivo(chi.idDispositivo) : chiaveIp(chi.ip);
    return [richiedente, chiaveTavolo(tavoloId)];
  }
}

function dtoDispositivo(d: DispositivoCliente): DispositivoClienteDto {
  return { id: d.id, soprannome: d.soprannome, emoji: d.emoji };
}

export function nuovoIdDispositivo(): string {
  return tokenCasuale(16);
}
