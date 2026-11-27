import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type CodaCassaDto,
  DisponibilitaSchema,
  type DisponibilitaRichiesta,
  EstendiTempoSchema,
  type EstendiTempoRichiesta,
  type EstensioneTuttiDto,
  type GiroCassaDto,
  type PiattoCassaDto,
  type PrecontoDto,
  RifiutaGiroSchema,
  type RifiutaGiroRichiesta,
  type TempoSedutaDto,
} from '@kikko/shared';
import { type UtenteRichiesta, attoreStaff } from '../auth/auth.types.js';
import { Ruoli, UtenteCorrente } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CassaService } from './cassa.service.js';

/** Manager / till (CLAUDE.md §2): rounds queue, sold-out dishes, extra time, pre-bill. */
@Controller()
@Ruoli('CAPO')
export class CassaController {
  constructor(private readonly cassa: CassaService) {}

  @Get('cassa/giri')
  coda(): Promise<CodaCassaDto> {
    return this.cassa.coda();
  }

  @Post('giri/:id/approva')
  @HttpCode(200)
  approva(
    @Param('id', new ParseUUIDPipe()) giroId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<GiroCassaDto> {
    return this.cassa.approva(giroId, attoreStaff(utente));
  }

  @Post('giri/:id/rifiuta')
  @HttpCode(200)
  rifiuta(
    @Param('id', new ParseUUIDPipe()) giroId: string,
    @Body(new ZodPipe(RifiutaGiroSchema)) body: RifiutaGiroRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<GiroCassaDto> {
    return this.cassa.rifiuta(giroId, body.motivo, attoreStaff(utente));
  }

  @Get('cassa/piatti')
  piatti(): Promise<PiattoCassaDto[]> {
    return this.cassa.piatti();
  }

  @Patch('piatti/:id/disponibilita')
  disponibilita(
    @Param('id', new ParseUUIDPipe()) piattoId: string,
    @Body(new ZodPipe(DisponibilitaSchema)) body: DisponibilitaRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<PiattoCassaDto> {
    return this.cassa.disponibilita(piattoId, body.disponibile, attoreStaff(utente));
  }

  @Post('sedute/:id/tempo')
  @HttpCode(200)
  estendi(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @Body(new ZodPipe(EstendiTempoSchema)) body: EstendiTempoRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<TempoSedutaDto> {
    return this.cassa.estendi(sedutaId, body.minuti, attoreStaff(utente));
  }

  @Post('cassa/estendi-tutti')
  @HttpCode(200)
  estendiTutti(
    @Body(new ZodPipe(EstendiTempoSchema)) body: EstendiTempoRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<EstensioneTuttiDto> {
    return this.cassa.estendiTutti(body.minuti, attoreStaff(utente));
  }

  @Post('sedute/:id/preconto')
  @HttpCode(200)
  preconto(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<PrecontoDto> {
    return this.cassa.preconto(sedutaId, attoreStaff(utente));
  }
}
