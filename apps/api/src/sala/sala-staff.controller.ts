import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import {
  type GiroDto,
  ImpostaVoceSchema,
  type ImpostaVoceRichiesta,
  InviaGiroSchema,
  type InviaGiroRichiesta,
  type SedutaClienteDto,
  type VoceCarrelloDto,
} from '@kikko/shared';
import type { Response } from 'express';
import { type UtenteRichiesta, attoreStaff } from '../auth/auth.types.js';
import { Ruoli, UtenteCorrente } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SalaService } from './sala.service.js';

/**
 * Ordering on behalf of a table (customers without a phone, CLAUDE.md §2).
 * Same cart and same rules as the customers; the waiter is recorded as the author.
 */
@Controller('sedute/:sedutaId')
@Ruoli('CAMERIERE')
export class SalaStaffController {
  constructor(private readonly sala: SalaService) {}

  @Get('sala')
  async stato(
    @Param('sedutaId', new ParseUUIDPipe()) sedutaId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SedutaClienteDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.sala.stato(await this.sala.ordinanteStaff(sedutaId, utente, attoreStaff(utente)));
  }

  @Put('carrello/:piattoId')
  async impostaVoce(
    @Param('sedutaId', new ParseUUIDPipe()) sedutaId: string,
    @Param('piattoId', new ParseUUIDPipe()) piattoId: string,
    @Body(new ZodPipe(ImpostaVoceSchema)) body: ImpostaVoceRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<VoceCarrelloDto[]> {
    const chi = await this.sala.ordinanteStaff(sedutaId, utente, attoreStaff(utente));
    return this.sala.impostaVoce(chi, piattoId, body.quantita);
  }

  @Post('giri')
  async inviaGiro(
    @Param('sedutaId', new ParseUUIDPipe()) sedutaId: string,
    @Body(new ZodPipe(InviaGiroSchema)) body: InviaGiroRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GiroDto> {
    const chi = await this.sala.ordinanteStaff(sedutaId, utente, attoreStaff(utente));
    const { giro, nuovo } = await this.sala.inviaGiro(chi, body.chiaveIdempotenza);
    res.status(nuovo ? HttpStatus.CREATED : HttpStatus.OK);
    return giro;
  }
}
