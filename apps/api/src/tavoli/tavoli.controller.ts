import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApriTavoloSchema, type ApriTavoloRichiesta, type SedutaConPin, type TavoloStato } from '@kikko/shared';
import { type UtenteRichiesta, attoreStaff } from '../auth/auth.types.js';
import { Ruoli, UtenteCorrente } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SeduteService } from './sedute.service.js';

@Controller()
export class TavoliController {
  constructor(private readonly sedute: SeduteService) {}

  @Get('tavoli')
  @Ruoli('CAMERIERE', 'MONITOR')
  elenco(): Promise<TavoloStato[]> {
    return this.sedute.elencoTavoli();
  }

  @Post('tavoli/:id/apri')
  @Ruoli('CAMERIERE')
  apri(
    @Param('id', new ParseUUIDPipe()) tavoloId: string,
    @Body(new ZodPipe(ApriTavoloSchema)) body: ApriTavoloRichiesta,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaConPin> {
    return this.sedute.apri(tavoloId, body, attoreStaff(utente));
  }

  @Post('sedute/:id/pin')
  @Ruoli('CAMERIERE')
  @HttpCode(200)
  rigeneraPin(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<SedutaConPin> {
    return this.sedute.rigeneraPin(sedutaId, attoreStaff(utente));
  }

  @Post('sedute/:id/chiudi')
  @Ruoli('CAPO')
  @HttpCode(204)
  async chiudi(
    @Param('id', new ParseUUIDPipe()) sedutaId: string,
    @UtenteCorrente() utente: UtenteRichiesta,
  ): Promise<void> {
    await this.sedute.chiudi(sedutaId, attoreStaff(utente));
  }
}
