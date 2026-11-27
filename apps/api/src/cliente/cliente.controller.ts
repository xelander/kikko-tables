import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type DispositivoClienteDto, JoinSchema, type JoinRichiesta, type StatoTavoloCliente } from '@kikko/shared';
import type { Request, Response } from 'express';
import { Pubblico } from '../auth/decorators.js';
import { COOKIE, GIORNO_MS, leggiCookie, opzioniCookie } from '../common/cookies.js';
import { LimitePubblico } from '../common/throttle.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Env } from '../config/env.js';
import { ClienteService, type Richiedente, nuovoIdDispositivo } from './cliente.service.js';

/** The customer token outlives any realistic meal; it is revoked server side when the table closes. */
const DURATA_TOKEN_CLIENTE_MS = 12 * 60 * 60_000;
const DURATA_ID_DISPOSITIVO_MS = 365 * GIORNO_MS;
const PATH_TAVOLO = '/api/t';

/** Public endpoints reached from the table QR code (`/t/{slug}`). */
@Controller('t')
@Pubblico()
export class ClienteController {
  private readonly secure: boolean;

  constructor(
    private readonly cliente: ClienteService,
    config: ConfigService<Env, true>,
  ) {
    this.secure = config.get('COOKIE_SECURE', { infer: true });
  }

  @Get(':slug')
  @LimitePubblico()
  async stato(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StatoTavoloCliente> {
    res.setHeader('Cache-Control', 'no-store');
    return this.cliente.stato(slug, leggiCookie(req.cookies, COOKIE.cliente), this.richiedente(req, res));
  }

  @Post(':slug/join')
  @LimitePubblico()
  @HttpCode(200)
  async join(
    @Param('slug') slug: string,
    @Body(new ZodPipe(JoinSchema)) body: JoinRichiesta,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DispositivoClienteDto> {
    const esito = await this.cliente.unisciti(slug, body.pin, body.soprannome, this.richiedente(req, res));
    // Path "/" so the token also reaches the Socket.IO handshake.
    res.cookie(COOKIE.cliente, esito.token, opzioniCookie(this.secure, '/', DURATA_TOKEN_CLIENTE_MS));
    return esito.dispositivo;
  }

  /** Reads (or assigns) the anonymous device id used to count wrong PINs per device. */
  private richiedente(req: Request, res: Response): Richiedente {
    let idDispositivo = leggiCookie(req.cookies, COOKIE.idDispositivo);
    if (!idDispositivo) {
      idDispositivo = nuovoIdDispositivo();
      res.cookie(
        COOKIE.idDispositivo,
        idDispositivo,
        opzioniCookie(this.secure, PATH_TAVOLO, DURATA_ID_DISPOSITIVO_MS),
      );
      // The first request of a device has no cookie yet: count it by IP.
      return { idDispositivo: null, ip: req.ip ?? 'sconosciuto' };
    }
    return { idDispositivo, ip: req.ip ?? 'sconosciuto' };
  }
}
