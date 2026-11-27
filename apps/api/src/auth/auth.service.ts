import { ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DispositivoCondivisoInfo, SessioneStaff } from '@kikko/shared';
import { verify } from 'argon2';
import { randomUUID } from 'node:crypto';
import { sha256, tokenCasuale } from '../common/crypto.js';
import type { Env } from '../config/env.js';
import type { DispositivoStaff, UtenteStaff } from '../generated/prisma/client.js';
import { BlocchiService, chiaveLogin, chiaveStaffPin } from '../pin/blocchi.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from './auth.types.js';

/** A rotated refresh token reused within this window is a concurrent refresh, not theft. */
const TOLLERANZA_RIUSO_MS = 15_000;

export interface EsitoAccesso {
  sessione: SessioneStaff;
  refreshToken: string;
  refreshMaxAgeMs: number;
}

/**
 * Staff authentication (CLAUDE.md §5 and decision 14.5):
 * - personal login with username and password;
 * - shared restaurant device + personal PIN;
 * - short-lived JWT access token, refresh token in an httpOnly cookie rotated on every use
 *   (reusing an already rotated token revokes the whole family).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly blocchi: BlocchiService,
  ) {}

  async login(username: string, password: string, dispositivo: DispositivoStaff | null): Promise<EsitoAccesso> {
    const utente = await this.prisma.utenteStaff.findUnique({ where: { username } });
    const ok = utente?.attivo === true && (await verify(utente.passwordHash, password).catch(() => false));
    await this.contaTentativo(chiaveLogin(username), ok);
    if (!utente || !ok) throw new UnauthorizedException({ codice: 'CREDENZIALI_ERRATE' });
    return this.apriSessione(utente, dispositivo, randomUUID());
  }

  async loginPin(utenteId: string, pin: string, dispositivo: DispositivoStaff): Promise<EsitoAccesso> {
    const utente = await this.prisma.utenteStaff.findUnique({ where: { id: utenteId } });
    const abilitato = utente?.attivo === true && utente.pinHash !== null && utente.ruolo !== 'MONITOR';
    const ok = abilitato && (await verify(utente.pinHash!, pin).catch(() => false));
    await this.contaTentativo(chiaveStaffPin(utenteId), ok);
    if (!utente || !ok) throw new UnauthorizedException({ codice: 'PIN_ERRATO' });
    return this.apriSessione(utente, dispositivo, randomUUID());
  }

  /** Rotates the refresh token. Detects reuse of an old token and revokes the family. */
  async rinnova(refreshToken: string): Promise<EsitoAccesso> {
    const riga = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { utente: true, dispositivoStaff: true },
    });
    const ora = new Date();
    if (!riga || riga.revocatoIl || riga.scadeIl <= ora)
      throw new UnauthorizedException({ codice: 'SESSIONE_SCADUTA' });
    if (riga.usatoIl) {
      if (ora.getTime() - riga.usatoIl.getTime() <= TOLLERANZA_RIUSO_MS) {
        // Two tabs refreshed at the same time: the other one already set the new cookie.
        throw new ConflictException({ codice: 'RIPROVA' });
      }
      await this.revocaFamiglia(riga.famiglia);
      throw new UnauthorizedException({ codice: 'SESSIONE_REVOCATA' });
    }
    if (!riga.utente.attivo || riga.dispositivoStaff?.revocatoIl) {
      await this.revocaFamiglia(riga.famiglia);
      throw new UnauthorizedException({ codice: 'SESSIONE_REVOCATA' });
    }
    const segnato = await this.prisma.refreshToken.updateMany({
      where: { id: riga.id, usatoIl: null },
      data: { usatoIl: ora },
    });
    if (segnato.count === 0) throw new ConflictException({ codice: 'RIPROVA' });
    return this.apriSessione(riga.utente, riga.dispositivoStaff, riga.famiglia);
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return;
    const riga = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (riga) await this.revocaFamiglia(riga.famiglia);
  }

  // ---------- Shared devices ----------

  async dispositivoDaToken(token: string | null): Promise<DispositivoStaff | null> {
    if (!token) return null;
    const dispositivo = await this.prisma.dispositivoStaff.findUnique({ where: { tokenHash: sha256(token) } });
    return dispositivo && !dispositivo.revocatoIl ? dispositivo : null;
  }

  async registraDispositivo(
    nome: string,
    registratoDa: string,
  ): Promise<{ dispositivo: DispositivoStaff; token: string }> {
    const token = tokenCasuale();
    const dispositivo = await this.prisma.dispositivoStaff.create({
      data: { nome, tokenHash: sha256(token), registratoDa },
    });
    return { dispositivo, token };
  }

  async infoDispositivo(dispositivo: DispositivoStaff | null): Promise<DispositivoCondivisoInfo> {
    if (!dispositivo) return { registrato: false, nome: null, utenti: [] };
    await this.prisma.dispositivoStaff.update({ where: { id: dispositivo.id }, data: { ultimoAccesso: new Date() } });
    const utenti = await this.prisma.utenteStaff.findMany({
      where: { attivo: true, pinHash: { not: null }, ruolo: { in: ['CAMERIERE', 'CAPO', 'ADMIN'] } },
      select: { id: true, nome: true, ruolo: true },
      orderBy: { nome: 'asc' },
    });
    return { registrato: true, nome: dispositivo.nome, utenti };
  }

  // ---------- internals ----------

  private async apriSessione(
    utente: UtenteStaff,
    dispositivo: DispositivoStaff | null,
    famiglia: string,
  ): Promise<EsitoAccesso> {
    const ttlAccess = this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    // On a shared device a user session lasts a shift; on a personal phone it lasts months.
    const refreshMaxAgeMs = dispositivo
      ? this.config.get('SHARED_DEVICE_SESSION_TTL_HOURS', { infer: true }) * 60 * 60_000
      : this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60_000;

    const refreshToken = tokenCasuale();
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: sha256(refreshToken),
        famiglia,
        utenteId: utente.id,
        dispositivoStaffId: dispositivo?.id ?? null,
        scadeIl: new Date(Date.now() + refreshMaxAgeMs),
      },
    });

    const payload: JwtPayload = {
      sub: utente.id,
      nome: utente.nome,
      username: utente.username,
      ruolo: utente.ruolo,
      ...(dispositivo ? { dev: dispositivo.id } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: ttlAccess });
    return {
      refreshToken,
      refreshMaxAgeMs,
      sessione: {
        accessToken,
        scadeTra: ttlAccess,
        utente: { id: utente.id, nome: utente.nome, username: utente.username, ruolo: utente.ruolo },
        dispositivo: dispositivo ? { id: dispositivo.id, nome: dispositivo.nome } : null,
      },
    };
  }

  private async revocaFamiglia(famiglia: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { famiglia, revocatoIl: null },
      data: { revocatoIl: new Date() },
    });
  }

  /** Same lockout rules as table PINs, per username or per staff user. */
  private async contaTentativo(chiave: string, riuscito: boolean): Promise<void> {
    const ora = new Date();
    const secondi = await this.prisma.$transaction(async (tx) => {
      await this.blocchi.blocca(tx, [chiave]);
      const bloccato = await this.blocchi.secondiBlocco(tx, [chiave], ora);
      if (bloccato > 0) return bloccato;
      if (riuscito) await this.blocchi.azzera(tx, [chiave]);
      else await this.blocchi.registraFallimento(tx, [chiave], ora);
      return 0;
    });
    if (secondi > 0) {
      throw new HttpException({ codice: 'BLOCCATO', riprovaTraSecondi: secondi }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
