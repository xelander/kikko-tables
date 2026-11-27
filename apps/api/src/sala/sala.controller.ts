import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Put, Res, UseGuards } from '@nestjs/common';
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
import { Pubblico } from '../auth/decorators.js';
import { ClienteCorrente, ClienteGuard } from '../cliente/cliente.guard.js';
import type { ClienteAutenticato } from '../cliente/cliente.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SalaService } from './sala.service.js';

/** Customer ordering: session state, shared cart, rounds. Authenticated by the device cookie. */
@Controller('cliente')
@Pubblico()
@UseGuards(ClienteGuard)
export class SalaController {
  constructor(private readonly sala: SalaService) {}

  @Get('seduta')
  stato(
    @ClienteCorrente() cliente: ClienteAutenticato,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SedutaClienteDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.sala.stato(cliente);
  }

  @Put('carrello/:piattoId')
  impostaVoce(
    @ClienteCorrente() cliente: ClienteAutenticato,
    @Param('piattoId', new ParseUUIDPipe()) piattoId: string,
    @Body(new ZodPipe(ImpostaVoceSchema)) body: ImpostaVoceRichiesta,
  ): Promise<VoceCarrelloDto[]> {
    return this.sala.impostaVoce(cliente, piattoId, body.quantita);
  }

  /** 201 for a new round, 200 when the key was already used (the same round is returned). */
  @Post('giri')
  async inviaGiro(
    @ClienteCorrente() cliente: ClienteAutenticato,
    @Body(new ZodPipe(InviaGiroSchema)) body: InviaGiroRichiesta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GiroDto> {
    const { giro, nuovo } = await this.sala.inviaGiro(cliente, body.chiaveIdempotenza);
    res.status(nuovo ? HttpStatus.CREATED : HttpStatus.OK);
    return giro;
  }
}
