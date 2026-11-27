import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type DispositivoCondivisoInfo,
  LoginPinSchema,
  type LoginPinRichiesta,
  LoginSchema,
  type LoginRichiesta,
  RegistraDispositivoSchema,
  type SessioneStaff,
  type UtenteStaffDto,
} from '@kikko/shared';
import type { Request, Response } from 'express';
import { COOKIE, GIORNO_MS, PATH_AUTH, cancellaCookie, leggiCookie, opzioniCookie } from '../common/cookies.js';
import { LimitePubblico } from '../common/throttle.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Env } from '../config/env.js';
import { AuthService, type EsitoAccesso } from './auth.service.js';
import type { UtenteRichiesta } from './auth.types.js';
import { Pubblico, Ruoli, UtenteCorrente } from './decorators.js';

/** Browsers cap cookie lifetime at 400 days. */
const DURATA_DISPOSITIVO_MS = 400 * GIORNO_MS;

@Controller('auth')
export class AuthController {
  private readonly secure: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.secure = config.get('COOKIE_SECURE', { infer: true });
  }

  /** Personal login with username and password. */
  @Post('login')
  @Pubblico()
  @LimitePubblico()
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginSchema)) body: LoginRichiesta,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessioneStaff> {
    const dispositivo = await this.auth.dispositivoDaToken(leggiCookie(req.cookies, COOKIE.dispositivoStaff));
    return this.rispondi(res, await this.auth.login(body.username, body.password, dispositivo));
  }

  /** Login with a personal PIN, only from a registered shared device. */
  @Post('pin')
  @Pubblico()
  @LimitePubblico()
  @HttpCode(200)
  async loginPin(
    @Body(new ZodPipe(LoginPinSchema)) body: LoginPinRichiesta,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessioneStaff> {
    const dispositivo = await this.auth.dispositivoDaToken(leggiCookie(req.cookies, COOKIE.dispositivoStaff));
    if (!dispositivo) throw new UnauthorizedException({ codice: 'DISPOSITIVO_NON_REGISTRATO' });
    return this.rispondi(res, await this.auth.loginPin(body.utenteId, body.pin, dispositivo));
  }

  /** Exchanges the refresh cookie for a new access token (and a new refresh cookie). */
  @Post('refresh')
  @Pubblico()
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessioneStaff> {
    const token = leggiCookie(req.cookies, COOKIE.refresh);
    if (!token) throw new UnauthorizedException({ codice: 'SESSIONE_SCADUTA' });
    try {
      return this.rispondi(res, await this.auth.rinnova(token));
    } catch (error) {
      if (error instanceof UnauthorizedException) cancellaCookie(res, COOKIE.refresh, this.secure, PATH_AUTH);
      throw error;
    }
  }

  /** Ends the user session. A shared device stays registered. */
  @Post('logout')
  @Pubblico()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(leggiCookie(req.cookies, COOKIE.refresh));
    cancellaCookie(res, COOKIE.refresh, this.secure, PATH_AUTH);
  }

  @Get('me')
  me(@UtenteCorrente() utente: UtenteRichiesta): UtenteStaffDto & { dispositivoStaffId: string | null } {
    return utente;
  }

  /** Whether this browser is a registered shared device, and who can log in with a PIN. */
  @Get('dispositivo')
  @Pubblico()
  async dispositivo(@Req() req: Request): Promise<DispositivoCondivisoInfo> {
    return this.auth.infoDispositivo(
      await this.auth.dispositivoDaToken(leggiCookie(req.cookies, COOKIE.dispositivoStaff)),
    );
  }

  /** Registers this browser as a shared restaurant device (manager or admin, from the device itself). */
  @Post('dispositivo')
  @Ruoli('CAPO')
  @HttpCode(201)
  async registraDispositivo(
    @Body(new ZodPipe(RegistraDispositivoSchema)) body: { nome: string },
    @UtenteCorrente() utente: UtenteRichiesta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; nome: string }> {
    const { dispositivo, token } = await this.auth.registraDispositivo(body.nome, utente.id);
    res.cookie(COOKIE.dispositivoStaff, token, opzioniCookie(this.secure, PATH_AUTH, DURATA_DISPOSITIVO_MS));
    return { id: dispositivo.id, nome: dispositivo.nome };
  }

  /** Forgets the shared device credential on this browser. */
  @Delete('dispositivo')
  @Pubblico()
  @HttpCode(204)
  dimenticaDispositivo(@Res({ passthrough: true }) res: Response): void {
    cancellaCookie(res, COOKIE.dispositivoStaff, this.secure, PATH_AUTH);
  }

  private rispondi(res: Response, esito: EsitoAccesso): SessioneStaff {
    res.cookie(COOKIE.refresh, esito.refreshToken, opzioniCookie(this.secure, PATH_AUTH, esito.refreshMaxAgeMs));
    res.setHeader('Cache-Control', 'no-store');
    return esito.sessione;
  }
}
